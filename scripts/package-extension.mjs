import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ZipArchive } from "archiver";

const root = resolve(import.meta.dirname, "..");
const releaseDirectory = resolve(root, "release");
const manifest = (await import("../manifest.json", { with: { type: "json" } })).default;
const archivePath = resolve(releaseDirectory, `multiplatform-creator-discovery-v${manifest.version}.zip`);

await mkdir(releaseDirectory, { recursive: true });

await new Promise((resolvePromise, reject) => {
  const output = createWriteStream(archivePath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on("close", resolvePromise);
  output.on("error", reject);
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(resolve(root, "dist"), false);
  archive.finalize();
});

console.log(`release package: ${archivePath}`);
