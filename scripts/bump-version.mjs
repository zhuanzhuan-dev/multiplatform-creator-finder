import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "manifest.json");
const packagePath = resolve(root, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const [major, minor, patch] = String(manifest.version).split(".").map(Number);
const kind = process.argv[2] || "patch";

if (![major, minor, patch].every(Number.isInteger) || !["patch", "minor", "major"].includes(kind)) {
  throw new Error("版本号或递增类型无效");
}

const next = kind === "major"
  ? `${major + 1}.0.0`
  : kind === "minor"
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;

manifest.version = next;
manifest.version_name = next;
packageJson.version = next;

await Promise.all([
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
]);

console.log(`version bumped: V${next}`);
