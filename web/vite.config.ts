import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api calls are proxied to the agent backend, so no CORS setup is needed in dev.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:4000" } },
});
