import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      // Private build proofs contain their own index.html. Watching these
      // scratch copies would reload an unrelated learner's active page.
      watch: { ignored: ["**/.local/**", "**/test-results/**", "**/playwright-report/**"] },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${env.API_PORT || env.PORT || 3001}`,
          changeOrigin: false,
        },
      },
    },
    build: { outDir: "dist" },
  };
});
