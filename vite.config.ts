import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;
const outputDirectory = resolve(root, "dist");

function extensionRuntime(): Plugin {
  const watchedFiles = [
    "background.js",
    "manifest.json",
    "workbench-bridge.js",
    "page/page-bridge.js",
    "content/douyin-content.js",
    "lib/platform-routes.js",
    "lib/douyin-page-parser.js",
    "src/content/douyin-recommend.ts",
    "src/core/platform-router.ts"
  ];

  return {
    name: "extension-runtime",
    buildStart() {
      for (const file of watchedFiles) this.addWatchFile(resolve(root, file));
    },
    async closeBundle() {
      await Promise.all([
        esbuild({
          entryPoints: [resolve(root, "background.js")],
          outfile: resolve(outputDirectory, "background.js"),
          bundle: true,
          format: "esm",
          platform: "browser",
          target: "chrome120",
          legalComments: "none"
        }),
        esbuild({
          entryPoints: [resolve(root, "src/content/douyin-recommend.ts")],
          outfile: resolve(outputDirectory, "content/douyin-content.js"),
          bundle: true,
          format: "iife",
          platform: "browser",
          target: "chrome120",
          legalComments: "none"
        }),
        esbuild({
          entryPoints: [resolve(root, "page/page-bridge.js")],
          outfile: resolve(outputDirectory, "page/page-bridge.js"),
          bundle: true,
          format: "iife",
          platform: "browser",
          target: "chrome120",
          legalComments: "none"
        }),
        esbuild({
          entryPoints: [resolve(root, "workbench-bridge.js")],
          outfile: resolve(outputDirectory, "workbench-bridge.js"),
          bundle: true,
          format: "iife",
          platform: "browser",
          target: "chrome120",
          legalComments: "none"
        })
      ]);

      const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
      await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), extensionRuntime()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
    rollupOptions: {
      input: [
        resolve(root, "sidepanel/index.html"),
        resolve(root, "updates/index.html")
      ],
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
