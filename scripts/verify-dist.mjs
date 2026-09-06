import { access, readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const backgroundSource = await readFile(resolve(dist, manifest.background?.service_worker || "background.js"), "utf8");

if (manifest.version !== packageJson.version) {
  throw new Error(`版本号不一致：manifest=${manifest.version}，package=${packageJson.version}`);
}

const referencedFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...manifest.content_scripts.flatMap((entry) => entry.js || []),
  "sidepanel/index.html",
  "updates/index.html"
].filter(Boolean);

if (manifest.side_panel?.default_path !== "sidepanel/index.html") {
  throw new Error("sidepanel 缺少全局入口，无法在任意标签页首次打开");
}
if (manifest.options_page) {
  throw new Error("高级设置仍配置为独立 options 页面，必须保留在侧边栏内");
}
if (backgroundSource.includes("chrome.windows.create")) {
  throw new Error("background 仍会创建独立工作窗口");
}
if (!backgroundSource.includes("chrome.sidePanel.setOptions") || !backgroundSource.includes("current-tab")) {
  throw new Error("background 缺少侧边栏启用或任务 tab 绑定逻辑");
}
if (!/openPanelOnActionClick\s*:\s*(?:true|!0)/.test(backgroundSource)) {
  throw new Error("background 未启用工具栏图标直接打开侧边栏");
}
if (backgroundSource.includes("已切换到其他标签页") || backgroundSource.includes("已切换到其他浏览器窗口")) {
  throw new Error("background 仍会因切换标签页或窗口暂停任务");
}
if (!backgroundSource.includes("message.runId") || !backgroundSource.includes("sender.tab.id")) {
  throw new Error("background 缺少 runId + tabId 的采集消息隔离");
}

for (const file of referencedFiles) await access(resolve(dist, file));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(dist);
const totalBytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, item) => sum + item.size, 0);
const forbidden = files.filter((file) => /(?:\.test\.|\.map$|design-qa|node_modules|package\.json$)/.test(file));
if (forbidden.length) throw new Error(`dist 含有开发文件：${forbidden.join(", ")}`);
if (files.some((file) => file.endsWith("live-radar.png"))) throw new Error("dist 仍包含旧的静态雷达图");
if (files.some((file) => /\/options\//.test(file))) throw new Error("dist 仍包含已移除的独立高级设置页面");

const javascript = (await Promise.all(files.filter((file) => file.endsWith(".js")).map((file) => readFile(file, "utf8")))).join("\n");
if (javascript.includes("openOptionsPage")) throw new Error("侧边栏仍会打开独立高级设置页面");

console.log(`dist verified: ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KiB, V${manifest.version_name || manifest.version}`);
