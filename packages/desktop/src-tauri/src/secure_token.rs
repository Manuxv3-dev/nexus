//! Stockage du refresh token dans le magasin de secrets de l'OS (cf. ADR-038).
//!
//! Sur desktop, le front est servi depuis une origine locale et appelle l'API
//! en absolu : c'est cross-site, donc le cookie `SameSite=Strict` qui porte le
//! refresh token en mode web n'est jamais renvoyé. Le desktop passe donc en
//! mode natif, où le token est une valeur applicative — qu'il faut bien ranger
//! quelque part entre deux lancements.
//!
//! Ce quelque part est le magasin du système : Credential Manager sous Windows,
//! Keychain sous macOS, Secret Service (via D-Bus) sous Linux. `localStorage`
//! est explicitement exclu par ADR-038 — le refresh token vit 30 jours, là où
//! l'access token que l'on refuse déjà d'y mettre vit 15 minutes.
//!
//! ## Dégradation
//!
//! Le magasin n'est pas garanti disponible : une session Linux minimale peut
//! n'avoir aucun Secret Service. Les commandes renvoient donc une erreur
//! *lisible* plutôt que de paniquer, et l'appelant côté front est chargé de
//! retomber sur la session en mémoire. **Un échec de stockage n'est pas un
//! échec d'authentification** : il coûte la persistance, pas l'accès.
//!
//! Corollaire important pour `get` : l'absence d'entrée n'est pas une erreur.
//! C'est le cas nominal du tout premier lancement, et il doit se distinguer
//! d'un magasin en panne — d'où `Option<String>` plutôt qu'un `Result` qui
//! confondrait « pas encore de session » et « magasin inaccessible ».

use keyring::Entry;

/// Espace de nommage dans le magasin de l'OS — l'identifiant du bundle, pour
/// que l'entrée soit attribuable à Nexus dans les interfaces système
/// (`Gestionnaire d'identification`, `Trousseau d'accès`, `seahorse`).
///
/// Suffixé `.dev` en build de debug (`tauri-dev`). Sans ça, le binaire de dev
/// et l'app installée lisent et écrivent **la même entrée** : un dev lancé sans
/// backend efface le token de l'app installée (vécu le 2026-09-15), et un dev
/// pointé sur l'API de prod fait tourner un token que l'autre binaire rejoue
/// ensuite — ce que le backend lit comme un vol, et qui révoque toutes les
/// sessions de l'utilisateur (cf. 39741148). Deux binaires, deux sessions.
const SERVICE: &str = service_name(cfg!(debug_assertions));

/// Le nom de l'espace selon le profil de build — extrait de `SERVICE` pour
/// être testable dans les deux branches, quel que soit le profil des tests.
const fn service_name(debug: bool) -> &'static str {
    if debug {
        "chat.nexusapp.desktop.dev"
    } else {
        "chat.nexusapp.desktop"
    }
}

/// Une seule entrée : le refresh token de la session courante. Nommée plutôt
/// que numérotée — le multi-compte n'existe pas et n'est pas au programme.
const ACCOUNT: &str = "refresh-token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("magasin de secrets indisponible : {e}"))
}

/// Range le refresh token. Écrase l'éventuel token précédent — la rotation
/// côté backend en produit un nouveau à chaque refresh, et garder l'ancien
/// n'aurait aucun intérêt : il vient d'être révoqué.
#[tauri::command]
pub fn secure_token_set(token: String) -> Result<(), String> {
    entry()?
        .set_password(&token)
        .map_err(|e| format!("écriture du token impossible : {e}"))
}

/// Relit le refresh token.
///
/// `Ok(None)` = pas d'entrée, cas nominal au premier lancement ou après un
/// logout. `Err` = le magasin lui-même est inaccessible. L'appelant traite les
/// deux pareil (pas de session restaurée), mais seul le second mérite un log.
#[tauri::command]
pub fn secure_token_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("lecture du token impossible : {e}")),
    }
}

/// Efface le refresh token (logout, suppression de compte).
///
/// L'absence d'entrée est un succès, pas une erreur : le but est qu'il n'y ait
/// plus rien, et il n'y a déjà plus rien. Faire échouer un logout parce que le
/// token avait déjà disparu serait absurde.
#[tauri::command]
pub fn secure_token_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("suppression du token impossible : {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_release_use_distinct_entries() {
        // Le cœur du correctif : deux binaires, deux entrées. Un `tauri-dev`
        // ne doit plus pouvoir toucher la session de l'app installée.
        assert_ne!(service_name(true), service_name(false));
    }

    #[test]
    fn release_keeps_the_bundle_identifier() {
        // Les utilisateurs existants ont une entrée sous ce nom : la renommer
        // les déconnecterait tous à la mise à jour.
        assert_eq!(service_name(false), "chat.nexusapp.desktop");
    }

    #[test]
    fn debug_is_a_suffixed_variant_of_the_same_identifier() {
        // Reste attribuable à Nexus dans le gestionnaire d'identifiants de
        // l'OS, tout en étant distinct.
        assert!(service_name(true).starts_with("chat.nexusapp.desktop"));
        assert!(service_name(true).ends_with(".dev"));
    }
}
