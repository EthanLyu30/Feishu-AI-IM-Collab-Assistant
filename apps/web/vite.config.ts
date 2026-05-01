import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const proxyTarget = process.env.VITE_PROXY_API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": proxyTarget,
      "/health": proxyTarget
    }
  }
});
