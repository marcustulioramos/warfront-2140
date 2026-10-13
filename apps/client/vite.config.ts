import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: {
      "/health": "http://server:3000",
      "/state": "http://server:3000",
      "/ws": { target: "ws://server:3000", ws: true },
    },
  },
});
