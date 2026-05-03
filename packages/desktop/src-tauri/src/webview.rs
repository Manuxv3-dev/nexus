//! Commandes Tauri pour gérer les webviews encapsulées des providers
//! WhatsApp / Messenger (cf. ADR-022 + ADR-026).
//!
//! Architecture :
//!  - Le frontend React (composant `WebviewProviderPane`) réserve une zone
//!    visuelle pour héberger la webview, calcule ses bounds (`x`, `y`,
//!    `width`, `height`), et appelle `create_provider_webview`.
//!  - Cette commande crée une webview Tauri enfant attachée à la window
//!    principale, avec un `data_directory` dédié → cookies/sessions
//!    isolés par session (chaque session WhatsApp ou Messenger a son
//!    propre profil persistant).
//!  - Le frontend observe les changements de layout (ResizeObserver +
//!    onScroll) et appelle `set_provider_webview_bounds` pour synchroniser.
//!  - Au démontage du composant : `destroy_provider_webview` libère.
//!
//! Convention de label : `provider:{provider_type}:{session_id}`. Permet à
//! la même session de garder ses cookies entre ouvertures (le data_directory
//! est dérivé du label).
//!
//! Sécurité cookies : `data_directory` pointe sur un sous-dossier de
//! `app_data_dir()` (resolved par Tauri selon l'OS) — pas accessible aux
//! autres apps, vidé proprement par OS uninstall.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, Runtime,
    WebviewUrl,
};

/// Réponse standardisée des commandes webview.
#[derive(Serialize)]
pub struct WebviewCommandResult {
    pub ok: bool,
    pub label: String,
}

/// Erreur formattée renvoyée au frontend (Tauri sérialise les `Err(String)`
/// directement).
type CommandError = String;

/// Sanitize le label utilisé comme nom de dossier pour le data_directory.
/// On accepte uniquement [a-z0-9._:-] pour éviter tout traversal.
fn sanitize_label(label: &str) -> Result<String, CommandError> {
    if label.is_empty() || label.len() > 200 {
        return Err("label invalide (longueur)".into());
    }
    for c in label.chars() {
        let ok = c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':');
        if !ok {
            return Err(format!("label invalide (caractère interdit : {c:?})"));
        }
    }
    // Remplacer ':' par '__' dans le path filesystem (Windows interdit ':').
    Ok(label.replace(':', "__"))
}

/// Résout le chemin de partition cookies pour un label donné.
fn partition_dir<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<PathBuf, CommandError> {
    let safe = sanitize_label(label)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir indisponible : {e}"))?;
    Ok(base.join("webviews").join(safe))
}

#[derive(Deserialize)]
pub struct WebviewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Crée une webview enfant attachée à la window principale.
///
/// Si une webview avec ce `label` existe déjà, on update juste ses bounds
/// (pas de double-création). Idempotent.
#[tauri::command]
pub async fn create_provider_webview<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    url: String,
    bounds: WebviewBounds,
) -> Result<WebviewCommandResult, CommandError> {
    // Validation URL : on autorise uniquement https:// pour éviter les
    // injections file:// ou tauri://.
    if !url.starts_with("https://") {
        return Err(format!("url invalide (https requis) : {url}"));
    }
    let parsed_url = url
        .parse()
        .map_err(|e| format!("url invalide : {e}"))?;

    // Récupérer la `Window` (pas `WebviewWindow`) — `add_child` est défini
    // sur `Window` en Tauri 2.11. La window créée via tauri.conf.json est
    // accessible directement par `get_window("main")` (le manager expose
    // les deux variantes pour le même label).
    let main_window = app
        .get_window("main")
        .ok_or_else(|| "window principale introuvable".to_string())?;

    // Si la webview existe déjà : on resize et on retourne ok.
    if let Some(existing) = app.get_webview(&label) {
        existing
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| format!("set_position échoue : {e}"))?;
        existing
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| format!("set_size échoue : {e}"))?;
        return Ok(WebviewCommandResult {
            ok: true,
            label,
        });
    }

    let data_dir = partition_dir(&app, &label)?;
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        return Err(format!("création data_directory échoue : {e}"));
    }

    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed_url))
        .data_directory(data_dir);

    main_window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| format!("add_child échoue : {e}"))?;

    Ok(WebviewCommandResult { ok: true, label })
}

/// Met à jour les bounds d'une webview existante (suite à resize de la
/// fenêtre, scroll, switch de pane, etc.).
#[tauri::command]
pub async fn set_provider_webview_bounds<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    bounds: WebviewBounds,
) -> Result<WebviewCommandResult, CommandError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview introuvable : {label}"))?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| format!("set_position échoue : {e}"))?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| format!("set_size échoue : {e}"))?;
    Ok(WebviewCommandResult { ok: true, label })
}

/// Affiche / cache une webview sans la détruire (préserve les cookies +
/// state DOM). Utile pour switcher entre providers ou panes.
///
/// Implémenté via redimensionnement à 0×0 hors viewport : Tauri 2 n'expose
/// pas encore de `set_visible` natif sur les webviews enfants.
#[tauri::command]
pub async fn set_provider_webview_visible<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    visible: bool,
    bounds: Option<WebviewBounds>,
) -> Result<WebviewCommandResult, CommandError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview introuvable : {label}"))?;
    if visible {
        let b = bounds.ok_or_else(|| {
            "bounds requis quand visible=true (pour repositionner après hide)".to_string()
        })?;
        webview
            .set_position(LogicalPosition::new(b.x, b.y))
            .map_err(|e| format!("set_position échoue : {e}"))?;
        webview
            .set_size(LogicalSize::new(b.width, b.height))
            .map_err(|e| format!("set_size échoue : {e}"))?;
    } else {
        // Hide = position hors-écran + taille minimale.
        webview
            .set_position(LogicalPosition::new(-10000.0, -10000.0))
            .map_err(|e| format!("set_position (hide) échoue : {e}"))?;
        webview
            .set_size(LogicalSize::new(1.0, 1.0))
            .map_err(|e| format!("set_size (hide) échoue : {e}"))?;
    }
    Ok(WebviewCommandResult { ok: true, label })
}

/// Détruit une webview. Le data_directory (cookies + cache) est conservé
/// sur disque pour que la prochaine création réutilise la session — c'est
/// intentionnel (le user ne veut pas re-scanner le QR à chaque fois).
///
/// Pour un nettoyage explicite (équivalent "logout"), le frontend peut
/// supprimer le dossier via une commande dédiée — pas exposée en V1.
#[tauri::command]
pub async fn destroy_provider_webview<R: Runtime>(
    app: AppHandle<R>,
    label: String,
) -> Result<WebviewCommandResult, CommandError> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview introuvable : {label}"))?;
    webview
        .close()
        .map_err(|e| format!("close échoue : {e}"))?;
    Ok(WebviewCommandResult { ok: true, label })
}
