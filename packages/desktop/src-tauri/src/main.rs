// Empêche l'ouverture d'une console Windows en plus de la fenêtre principale
// quand on lance le binaire en mode release. En debug on garde la console
// pour voir les logs Rust dans le terminal.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nexus_lib::run()
}
