import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: "./src/testSetup.ts", include: ["src/**/*.test.{ts,tsx}"] },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT || 5173),
    proxy: {
      "/api": process.env.API_PROXY || "http://127.0.0.1:3000",
      "/healthz": process.env.API_PROXY || "http://127.0.0.1:3000",
      "/readyz": process.env.API_PROXY || "http://127.0.0.1:3000"
    }
  }
});
