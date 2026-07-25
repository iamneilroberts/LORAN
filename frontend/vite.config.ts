import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cesium ships its own Workers/Assets/Widgets that must be served as static files.
// We copy them into public/cesium via the "cesium:assets" npm script and point
// CESIUM_BASE_URL at them, rather than adding vite-plugin-cesium - the stack in
// CLAUDE.md does not list it and this is a two-line alternative.
export default defineConfig({
  plugins: [react()],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium/") },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8010", changeOrigin: true } },
  },
});
