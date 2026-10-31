import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const src = (dir) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // One alias per top folder of `src` (mirrored in jsconfig.json for the editor).
  resolve: {
    alias: {
      "@app": src("App"),
      "@pages": src("pages"),
      "@components": src("components"),
      "@utils": src("utils"),
      "@hooks": src("hooks"),
      "@i18n": src("i18n"),
    },
  },
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
