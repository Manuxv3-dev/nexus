//! Commandes Tauri pour gérer les webviews encapsulées des providers
//! WhatsApp / Messenger (cf. ADR-022 + ADR-026).
//!
//! Architecture :
//!  - Le frontend React (composant `WebviewProviderPane`) réserve une zone
//!    visuelle pour héberger la webview, calcule ses bounds (`x`, `y`,
//!    `width`, `height`), et appelle `create_provider_webview`.
//!  - Cette commande crée une webview Tauri enfant attachée à la window
//!    principale, avec un `data_directory` dédié → cookies isolés par
//!    (utilisateur nexus, provider) (chaque compte WhatsApp/Discord/etc. a
//!    son propre profil persistant).
//!  - Le frontend observe les changements de layout (ResizeObserver +
//!    onScroll) et appelle `set_provider_webview_bounds` pour synchroniser.
//!  - Au démontage du composant : `destroy_provider_webview` libère.
//!
//! Convention de label : `provider:{provider_type}:{user_id}` (MAN-238).
//! Dérivé de l'utilisateur nexus, PAS de l'id de session provider — ce
//! dernier change à chaque reconnexion (`sessions.id` est un
//! `uuid().defaultRandom()`, régénéré par le backend à chaque
//! delete+recreate). Le backend garantit l'unicité `(provider_type,
//! external_id)` avec `external_id = 'webview:{user_id}'` : un même
//! utilisateur ne peut avoir qu'une session par provider, donc `user_id`
//! identifie la même partition à travers un cycle déconnexion/reconnexion —
//! contrairement à l'ancienne convention basée sur `session_id`, qui
//! produisait une partition vierge (donc une ré-authentification complète)
//! à chaque reconnexion.
//!
//! Sécurité cookies : `data_directory` pointe sur un sous-dossier de
//! `app_data_dir()` (resolved par Tauri selon l'OS) — pas accessible aux
//! autres apps, vidé proprement par OS uninstall.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
/// On accepte uniquement [A-Za-z0-9._:-] pour éviter tout traversal. Un
/// `user_id` UUID (hex minuscule + tirets) passe sans transformation.
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
    // `partition_dir` réduit `label` à un unique composant de chemin (le
    // charset ci-dessus ne contient aucun séparateur '/' ou '\'), donc seule
    // la chaîne entière "." ou ".." déclenche un traversal réel via `.join()`.
    // On rejette aussi ces valeurs sur chaque segment délimité par ':' en
    // défense en profondeur, au cas où la convention `provider:{type}:{id}`
    // finirait par mapper un segment sur un composant de chemin distinct.
    if label.split(':').any(|part| part == "." || part == "..") {
        return Err("label invalide (composant de chemin réservé)".into());
    }
    // Remplacer ':' par '__' dans le path filesystem (Windows interdit ':').
    Ok(label.replace(':', "__"))
}

/// Résout le dossier de base contenant toutes les partitions webview
/// (`app_data_dir()/webviews`).
fn webviews_base_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, CommandError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir indisponible : {e}"))?;
    Ok(base.join("webviews"))
}

/// Résout le chemin de partition cookies pour un label donné.
fn partition_dir<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<PathBuf, CommandError> {
    let safe = sanitize_label(label)?;
    Ok(webviews_base_dir(app)?.join(safe))
}

/// Calcule, pour chaque label, si son `data_directory` existe sous
/// `webviews_dir` — logique pure (pas d'`AppHandle`) pour rester testable
/// sans contexte Tauri complet. `provider_webview_data_status` ne fait que
/// résoudre `webviews_dir` puis déléguer ici.
fn compute_data_status(
    webviews_dir: &Path,
    labels: &[String],
) -> Result<HashMap<String, bool>, CommandError> {
    let mut status = HashMap::with_capacity(labels.len());
    for label in labels {
        let safe = sanitize_label(label)?;
        status.insert(label.clone(), webviews_dir.join(safe).exists());
    }
    Ok(status)
}

/// Supprime le dossier de partition d'un label sous `webviews_dir` — logique
/// pure (pas d'`AppHandle`) pour rester testable sans contexte Tauri complet.
/// `delete_provider_webview_data` ne fait que fermer la webview ouverte
/// (le cas échéant) puis déléguer ici pour le retrait effectif sur disque.
///
/// Idempotent : un dossier déjà absent n'est pas une erreur (double-clic
/// frontend, purge déjà effectuée, etc.).
fn delete_partition_dir(webviews_dir: &Path, label: &str) -> Result<(), CommandError> {
    let safe = sanitize_label(label)?;
    let dir = webviews_dir.join(safe);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("suppression data_directory échoue : {e}"))
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

/// Vérifie, pour un lot de labels, si leur `data_directory` existe encore
/// sur disque — lecture seule, aucune mutation.
///
/// Sert à piloter côté frontend l'affichage de l'action « supprimer les
/// données locales » par provider (MAN-239) : inutile de proposer un
/// nettoyage tant qu'aucune partition n'a été créée (pas de connexion
/// effectuée, ou déjà purgée précédemment).
///
/// Échoue dès le premier label invalide (même style fail-fast que les
/// autres commandes du module) plutôt que de retourner un statut partiel.
#[tauri::command]
pub async fn provider_webview_data_status<R: Runtime>(
    app: AppHandle<R>,
    labels: Vec<String>,
) -> Result<HashMap<String, bool>, CommandError> {
    let webviews_dir = webviews_base_dir(&app)?;
    compute_data_status(&webviews_dir, &labels)
}

/// Supprime réellement le `data_directory` d'un provider (cookies + cache) —
/// contrairement à `destroy_provider_webview` ci-dessus qui conserve
/// volontairement la partition. C'est la commande à appeler pour un
/// nettoyage explicite (équivalent "logout" / RGPD, MAN-239).
///
/// Si la webview est encore montée, on la ferme d'abord — on ne doit jamais
/// supprimer un dossier qui sert encore de backing store à une instance
/// WebView2/WebKit ouverte. Idempotent : un dossier déjà absent est un
/// succès, pas une erreur.
#[tauri::command]
pub async fn delete_provider_webview_data<R: Runtime>(
    app: AppHandle<R>,
    label: String,
) -> Result<WebviewCommandResult, CommandError> {
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| format!("close échoue : {e}"))?;
    }

    let webviews_dir = webviews_base_dir(&app)?;
    delete_partition_dir(&webviews_dir, &label)?;

    Ok(WebviewCommandResult { ok: true, label })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_label_accepts_normal_provider_label() {
        assert_eq!(
            sanitize_label("provider:discord:abc123").unwrap(),
            "provider__discord__abc123"
        );
    }

    #[test]
    fn sanitize_label_rejects_bare_traversal() {
        assert!(sanitize_label("..").is_err());
        assert!(sanitize_label(".").is_err());
    }

    #[test]
    fn sanitize_label_rejects_traversal_segment() {
        assert!(sanitize_label("provider:discord:..").is_err());
        assert!(sanitize_label("provider:discord:.").is_err());
        assert!(sanitize_label("..:discord:abc123").is_err());
    }

    #[test]
    fn sanitize_label_accepts_dots_within_a_segment() {
        // Un segment contenant des points sans être *exactement* "." ou
        // ".." n'est jamais interprété comme un traversal par l'OS (aucun
        // séparateur '/' ou '\' n'est autorisé dans le charset).
        assert_eq!(
            sanitize_label("provider:discord:user..name").unwrap(),
            "provider__discord__user..name"
        );
    }

    #[test]
    fn sanitize_label_rejects_forbidden_characters() {
        assert!(sanitize_label("provider/discord").is_err());
        assert!(sanitize_label("provider\\discord").is_err());
    }

    #[test]
    fn sanitize_label_rejects_empty_and_oversized() {
        assert!(sanitize_label("").is_err());
        assert!(sanitize_label(&"a".repeat(201)).is_err());
    }

    #[test]
    fn test_status_true_when_dir_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let label = "provider:discord:abc123".to_string();
        let safe = sanitize_label(&label).unwrap();
        std::fs::create_dir_all(tmp.path().join(&safe)).unwrap();

        let status = compute_data_status(tmp.path(), std::slice::from_ref(&label)).unwrap();

        assert_eq!(status.get(&label), Some(&true));
    }

    #[test]
    fn test_status_false_when_dir_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let label = "provider:discord:missing".to_string();

        let status = compute_data_status(tmp.path(), std::slice::from_ref(&label)).unwrap();

        assert_eq!(status.get(&label), Some(&false));
    }

    #[test]
    fn test_status_batch_multiple_labels() {
        let tmp = tempfile::tempdir().unwrap();
        let existing = "provider:discord:exists".to_string();
        let missing = "provider:whatsapp:missing".to_string();
        let safe = sanitize_label(&existing).unwrap();
        std::fs::create_dir_all(tmp.path().join(&safe)).unwrap();

        let status = compute_data_status(tmp.path(), &[existing.clone(), missing.clone()]).unwrap();

        assert_eq!(status.len(), 2);
        assert_eq!(status.get(&existing), Some(&true));
        assert_eq!(status.get(&missing), Some(&false));
    }

    #[test]
    fn test_status_rejects_invalid_label() {
        let tmp = tempfile::tempdir().unwrap();

        let result = compute_data_status(tmp.path(), &["provider/discord".to_string()]);

        assert!(result.is_err());
    }

    #[test]
    fn test_delete_removes_existing_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let label = "provider:discord:abc123".to_string();
        let safe = sanitize_label(&label).unwrap();
        let dir = tmp.path().join(&safe);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(dir.exists());

        let result = delete_partition_dir(tmp.path(), &label);

        assert!(result.is_ok());
        assert!(!dir.exists());
    }

    #[test]
    fn test_delete_idempotent_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let label = "provider:discord:missing".to_string();

        let result = delete_partition_dir(tmp.path(), &label);

        assert!(result.is_ok());
    }

    #[test]
    fn test_delete_rejects_invalid_label() {
        let tmp = tempfile::tempdir().unwrap();

        let result = delete_partition_dir(tmp.path(), "provider/discord");

        assert!(result.is_err());
    }

    // Comportement "ferme la webview ouverte avant suppression" : nécessite
    // un vrai AppHandle, donc pas testable via `delete_partition_dir` seul.
    // Tentative avec `tauri::test::mock_app()` (feature `test` du crate
    // `tauri`, cf. historique git de ce fichier) : compile, mais le binaire
    // de test crashe au lancement sur cette machine avec
    // `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139) — un échec de résolution de
    // DLL au démarrage du process, avant même que le harness n'exécute un
    // seul test, donc sans lien avec la logique testée ici. Pas creusé plus
    // loin (fragile, spécifique à cette install Windows) : cette étape reste
    // couverte par la vérification manuelle desktop (QA du plan MAN-239),
    // pas par un test unitaire. Le code source est structuré pour que ce
    // bloc reste trivialement correct par lecture : il reproduit exactement
    // le pattern `get_webview(&label) → close()` de
    // `destroy_provider_webview` ci-dessus.
}
