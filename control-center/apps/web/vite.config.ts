import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: "./src/testSetup.ts", include: ["src/**/*.test.{ts,tsx}"] },
  server: { host: "127.0.0.1", port: 5173 }
});
