/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  root: ".",
  test: {
    exclude: ["node_modules/**", "dist/**"]
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: false
  },
  server: {
    port: 5173,
    proxy: {
  "/api": {
    target: "http://localhost:8080",
    changeOrigin: true
  },
  "/socket.io": {
    target: "http://localhost:8080",
    ws: true,
    changeOrigin: true
  }
}
  }
});
