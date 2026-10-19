import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// The kit is bundled into each process's output, so the packaged app doesn't need it at runtime
// and the sandboxed preload stays one file.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ["pomerado-app-kit"] },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      // The kit is linked from a sibling folder; one copy of React, not two.
      dedupe: ["react", "react-dom"],
      alias: { "@shared": resolve(import.meta.dirname, "src/shared") },
    },
  },
});
