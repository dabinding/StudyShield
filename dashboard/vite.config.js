import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue()],
  base: "/dashboard-assets/",
  build: {
    outDir: fileURLToPath(new URL("../backend/public/dashboard", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false
  }
});
