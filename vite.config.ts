import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const { VITE_API_ORIGIN } = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "static-share-page",
        generateBundle: {
          order: "post",
          handler(_options, bundle) {
            const index = bundle["index.html"];
            if (index?.type !== "asset" || typeof index.source !== "string") {
              this.error("Missing the built homepage for the share preview.");
            }
            // Keep the share page beside the homepage so its relative assets resolve.
            let share = index.source;
            for (const attribute of [
              'rel="canonical" href',
              'property="og:url" content',
            ]) {
              const original = attribute + '="https://gaugecraft.sh/"';
              if (!share.includes(original)) {
                this.error("Missing homepage metadata: " + attribute);
              }
              share = share.replace(
                original,
                attribute + '="https://gaugecraft.sh/share.html"',
              );
            }
            this.emitFile({
              type: "asset",
              fileName: "share.html",
              source: share,
            });
          },
        },
      },
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
