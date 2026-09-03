import { execFileSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const action = process.argv[2] || "status";
const label = "com.a2.douyin-finder-bridge";
const uid = typeof process.getuid === "function" ? process.getuid() : null;
if (!Number.isInteger(uid)) throw new Error("无法确定当前 macOS 用户 UID");

const domain = `gui/${uid}`;
const serviceTarget = `${domain}/${label}`;
const workspace = resolve(import.meta.dirname, "..");
const serverPath = resolve(workspace, "bridge/server.mjs");
const launchAgentsDirectory = resolve(homedir(), "Library/LaunchAgents");
const plistPath = resolve(launchAgentsDirectory, `${label}.plist`);
const logPath = resolve(homedir(), "Library/Logs/a2-douyin-finder-bridge.log");
const errorLogPath = resolve(homedir(), "Library/Logs/a2-douyin-finder-bridge.error.log");
const servicePath = [
  dirname(process.execPath),
  resolve(homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
].join(":");

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function launchctl(args, ignoreFailure = false) {
  try {
    return execFileSync("launchctl", args, { encoding: "utf8", stdio: ignoreFailure ? "ignore" : ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (ignoreFailure) return "";
    throw new Error(error.stderr?.trim() || error.message);
  }
}

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workspace)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(servicePath)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(errorLogPath)}</string>
</dict>
</plist>
`;
}

if (action === "install") {
  await mkdir(launchAgentsDirectory, { recursive: true });
  await writeFile(plistPath, plist(), "utf8");
  launchctl(["bootout", serviceTarget], true);
  launchctl(["bootstrap", domain, plistPath]);
  launchctl(["enable", serviceTarget]);
  launchctl(["kickstart", "-k", serviceTarget]);
  console.log(`Bridge 常驻服务已安装并启动：${plistPath}`);
  console.log(`日志：${logPath}`);
} else if (action === "uninstall") {
  launchctl(["bootout", serviceTarget], true);
  await unlink(plistPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  console.log("Bridge 常驻服务已停止并卸载");
} else if (action === "status") {
  process.stdout.write(launchctl(["print", serviceTarget]));
} else {
  throw new Error(`未知操作：${action}。可用操作：install、status、uninstall`);
}
