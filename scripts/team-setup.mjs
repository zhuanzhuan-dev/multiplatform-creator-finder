import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensionDirectory = resolve(root, "dist");
const bundledConfigPath = resolve(root, "bridge/team.config.json");
const localConfigPath = resolve(root, "bridge/bridge.config.json");
const bridgeInstallerPath = resolve(root, "scripts/bridge-service.mjs");
const quietEnv = {
  ...process.env,
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
  LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
};
const requiredScopes = [
  "base:app:read",
  "base:table:read",
  "base:field:read",
  "base:record:read",
  "base:record:create",
  "base:record:update"
];

function section(text) {
  console.log(`\n\x1b[1;36m${text}\x1b[0m`);
}

function success(text) {
  console.log(`\x1b[32m✓ ${text}\x1b[0m`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: options.encoding ?? "utf8",
    env: quietEnv,
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.stdio || ["inherit", "pipe", "pipe"]
  });
}

function runJson(command, args) {
  try {
    const output = run(command, args);
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message;
    throw new Error(detail);
  }
}

async function isExecutable(path) {
  if (!path) return false;
  return access(path, constants.X_OK).then(() => true).catch(() => false);
}

async function findExecutable(name) {
  const candidates = [
    ...String(process.env.PATH || "").split(delimiter).map((directory) => resolve(directory, name)),
    resolve(process.env.HOME || "", ".local/bin", name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return candidate;
  }
  return "";
}

async function ensureLarkCli() {
  let larkCli = await findExecutable("lark-cli");
  if (larkCli) return larkCli;

  const pnpm = await findExecutable("pnpm");
  if (!pnpm) throw new Error("未找到 lark-cli，也未找到 pnpm。请先安装 Node.js 22 和 pnpm 10 后重新双击本安装程序。");
  section("安装飞书官方 lark-cli（只需一次）");
  run(pnpm, ["dlx", "@larksuite/cli@latest", "install"], { stdio: "inherit", encoding: null });
  larkCli = await findExecutable("lark-cli");
  if (!larkCli) throw new Error("lark-cli 安装完成但当前终端还无法定位它，请关闭此窗口后重新双击安装程序。");
  return larkCli;
}

function userAuthorized(status) {
  const user = status?.identities?.user;
  const scopes = new Set(String(user?.scope || "").split(/\s+/).filter(Boolean));
  return status?.verified === true
    && user?.status === "ready"
    && user?.verified !== false
    && requiredScopes.every((scope) => scopes.has(scope));
}

async function ensureLarkConfigAndAuth(larkCli) {
  section("检查飞书应用配置");
  try {
    runJson(larkCli, ["config", "show"]);
    success("飞书应用配置已存在");
  } catch {
    console.log("即将打开飞书官方配置向导，请按页面提示创建或选择应用。");
    run(larkCli, ["config", "init", "--new", "--brand", "feishu", "--lang", "zh_cn"], { stdio: "inherit", encoding: null });
    success("飞书应用配置完成");
  }

  section("检查当前同事的飞书授权");
  let status = null;
  try {
    status = runJson(larkCli, ["auth", "status", "--json", "--verify"]);
  } catch {
    status = null;
  }
  if (!userAuthorized(status)) {
    console.log("即将打开飞书授权页面，仅申请本工具读写多维表格所需的最小权限。");
    run(larkCli, ["auth", "login", "--scope", requiredScopes.join(" ")], { stdio: "inherit", encoding: null });
    status = runJson(larkCli, ["auth", "status", "--json", "--verify"]);
  }
  if (!userAuthorized(status)) throw new Error("飞书用户授权尚未完成，或多维表格权限不足。");
  success(`飞书用户授权有效：${status.identities.user.userName || "当前用户"}`);
}

function validateFieldContract(fields, config) {
  const byName = new Map(fields.map((field) => [field.name, field]));
  for (const name of Object.values(config.fields)) {
    if (!byName.has(name)) throw new Error(`目标多维表格缺少字段：${name}`);
  }
  for (const [fieldName, optionName] of [
    [config.fields.platform, config.values.platform],
    [config.fields.status, config.values.status],
    [config.fields.priority, "S级"],
    [config.fields.priority, "A级"],
    [config.fields.priority, "B级"]
  ]) {
    const field = byName.get(fieldName);
    if (field?.type !== "select") throw new Error(`字段“${fieldName}”必须是单选字段`);
    if (!(field.options || []).some((option) => option.name === optionName)) {
      throw new Error(`字段“${fieldName}”缺少选项：${optionName}`);
    }
  }
}

async function createLocalConfigAndVerify(larkCli) {
  section("写入内置团队目标并校验权限");
  const config = JSON.parse(await readFile(bundledConfigPath, "utf8"));
  config.larkCliPath = larkCli;
  await writeFile(localConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const envelope = runJson(larkCli, [
    "base", "+field-list",
    "--base-token", config.baseToken,
    "--table-id", config.tableId,
    "--limit", "200",
    "--as", "user",
    "--format", "json"
  ]);
  if (envelope.ok !== true) throw new Error(envelope.error?.message || "无法读取目标多维表格");
  validateFieldContract(envelope.data?.fields || [], config);
  success(`${config.destination.baseName} → ${config.destination.tableName}/${config.destination.viewName} 可读写`);
  return config;
}

async function waitForBridge(config) {
  const url = `http://127.0.0.1:${config.port || 17927}/health`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "X-Douyin-Finder-Token": config.token || "" }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error("Bridge 启动超时");
}

async function installBridge(config) {
  section("安装本机 Bridge 常驻服务");
  run(process.execPath, [bridgeInstallerPath, "install"], { stdio: "inherit", encoding: null });
  const health = await waitForBridge(config);
  success(`Bridge 已连接：${health.destination?.baseName || config.destination.baseName}`);
}

function openChromeAndCopyPath() {
  try {
    execFileSync("/usr/bin/pbcopy", [], { input: extensionDirectory, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // 剪贴板失败不影响安装。
  }
  try {
    execFileSync("/usr/bin/open", ["-a", "Google Chrome", "chrome://extensions"], { stdio: "ignore" });
  } catch {
    // 未安装 Chrome 时保留文字指引。
  }
}

if (process.platform !== "darwin") throw new Error("当前团队一键安装程序仅支持 macOS。");

try {
  section("多平台自动找号助手｜团队安装");
  await access(resolve(extensionDirectory, "manifest.json"));
  const larkCli = await ensureLarkCli();
  success(`已找到 lark-cli：${larkCli}`);
  await ensureLarkConfigAndAuth(larkCli);
  const config = await createLocalConfigAndVerify(larkCli);
  await installBridge(config);
  openChromeAndCopyPath();
  console.log("\n\x1b[1;32m安装完成。Chrome 扩展管理页已经打开。\x1b[0m");
  console.log("1. 开启右上角“开发者模式”");
  console.log("2. 点击“加载已解压的扩展程序”");
  console.log(`3. 选择构建产物文件夹（路径已复制）：${extensionDirectory}`);
  console.log("4. 打开插件，点“检测团队连接”；显示绿色后即可开始本轮。\n");
} catch (error) {
  console.error(`\n\x1b[31m安装未完成：${error?.message || String(error)}\x1b[0m`);
  console.error("如果提示无权访问目标多维表格，请让表格管理员先把“贴片自动化”分享给当前飞书账号。\n");
  process.exitCode = 1;
}
