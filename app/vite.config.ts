import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __BUNDLE_VERSION__: JSON.stringify(process.env.BUNDLE_VERSION ?? "dev") },
  server: {
    // cap sync copies the build into android/, which otherwise trips the watcher
    watch: { ignored: ["**/android/**", "**/dist/**"] },
    port: 5180,
    fs: { allow: [".", "../tcg-engines"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
  },
});
