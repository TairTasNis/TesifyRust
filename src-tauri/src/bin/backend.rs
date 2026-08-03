#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../backend.rs"]
mod backend;

#[tokio::main]
async fn main() {
    if let Err(err) = backend::run_backend().await {
        eprintln!("Tesify Rust backend stopped: {err}");
        std::process::exit(1);
    }
}
