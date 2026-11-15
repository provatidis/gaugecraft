import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const { VITE_API_ORIGIN } = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "preconnect-observation-api",
        transformIndexHtml() {
          if (!VITE_API_ORIGIN) return;
          return [
            {
              tag: "link",
              attrs: {
                rel: "preconnect",
                href: new URL(VITE_API_ORIGIN).origin,
                crossorigin: "anonymous",
              },
              injectTo: "head-prepend",
            },
          ];
        },
      },
    ],
    build: { chunkSizeWarningLimit: 800 },
  };
});
