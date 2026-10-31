import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Each component's CSS in its module: `s.noteAction` → `note-action_x7f2a`.
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
      generateScopedName: "[local]_[hash:base64:5]",
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
