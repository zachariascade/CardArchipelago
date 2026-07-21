import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/CloudArchideckture/" : "/",
  plugins: [react()],
  server: {
    proxy: {
      "/archidekt-api": {
        target: "https://archidekt.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/archidekt-api/, ""),
      },
    },
  },
});
