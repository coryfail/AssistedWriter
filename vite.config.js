import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        desktop: fileURLToPath(new URL("./index.html", import.meta.url)),
        web: fileURLToPath(new URL("./web.html", import.meta.url)),
      },
    },
  },
});
