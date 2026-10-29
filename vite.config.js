import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { basename, dirname } from "node:path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // CSS de cada componente en su módulo: `s.noteAction` → `note-action_x7f2a`.
  // Con LINGORA_CSS_CHECK=1 la clase lleva la carpeta (`note-action__Button`),
  // para que scripts/css-check.mjs la compare con el CSS original.
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
      generateScopedName: process.env.LINGORA_CSS_CHECK
        ? (name, file) => `${name}__${basename(dirname(file))}`
        : "[local]_[hash:base64:5]",
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari15",
    sourcemap: true,
  },
});
