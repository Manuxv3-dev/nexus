//! Entry point de l'application Tauri Nexus.
//!
//! Sépare `lib.rs` et `main.rs` selon la convention Tauri 2 — permet à terme
//! de réutiliser le même code pour les plateformes mobiles (Tauri 2 unifie
//! desktop + iOS + Android).
//!
//! Le shell ne fait que :
//!  1. Bootstrap la window principale (config dans tauri.conf.json)
//!  2. Enregistrer les plugins Tauri standards (shell pour `open external URL`)
//!  3. Enregistrer les commandes custom Nexus (cf. `webview` module)
//!
//! Le frontend React vit dans `@nexus/web` et est chargé via `devUrl` (dev) ou
//! `frontendDist` (build) — voir `tauri.conf.json`.

mod webview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());

    // Auto-updater (desktop only — pas dispo iOS/Android via cfg).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            webview::create_provider_webview,
            webview::set_provider_webview_bounds,
            webview::set_provider_webview_visible,
            webview::destroy_provider_webview,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Nexus desktop app");
}
