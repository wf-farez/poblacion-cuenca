import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" => el build funciona en cualquier subcarpeta ()
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks: { maplibre: ["maplibre-gl"] } },
    },
  },
});
