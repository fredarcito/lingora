fn main() {
    #[cfg(target_os = "macos")]
    link_clang_runtime();
    tauri_build::build()
}

/// llama.cpp (Metal) usa `@available`, que llama a `__isPlatformVersionAtLeast`
/// de la librería del compilador. Rust no siempre la enlaza (en `release`
/// fallaba), así que se enlaza a mano. Es estática: va dentro del binario.
#[cfg(target_os = "macos")]
fn link_clang_runtime() {
    let Ok(out) = std::process::Command::new("clang").arg("-print-resource-dir").output() else {
        return;
    };
    let dir = std::path::PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()).join("lib/darwin");
    if dir.join("libclang_rt.osx.a").exists() {
        println!("cargo:rustc-link-search=native={}", dir.display());
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
}
