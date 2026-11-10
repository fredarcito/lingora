// Prevents an extra console from opening on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lingora_lib::run()
}
