import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const localConfigPath = resolve(process.env.DRA_BRIDGE_CONFIG || "bridge/bridge.config.json");
const bundledConfigPath = resolve("bridge/team.config.json");
let configText;
try {
  configText = await readFile(localConfigPath, "utf8");
} catch (error) {
  if (process.env.DRA_BRIDGE_CONFIG) throw new Error(`无法读取指定 Bridge 配置：${localConfigPath}`);
  configText = await readFile(bundledConfigPath, "utf8").catch(() => {
    throw new Error(`缺少 Bridge 配置：${localConfigPath} 或 ${bundledConfigPath}`);
  });
}
const config = JSON.parse(configText);

const requiredFields = ["platform", "accountName", "followers", "videoUrl", "status", "priority", "note"];
const port = Number(config.port || 17927);
const CACHE_TTL_MS = 10 * 60_000;
let schemaCache = null;
let schemaCachedAt = 0;
let schemaRefreshPromise = null;
let indexCache = null;
let indexCachedAt = 0;
let indexRefreshPromise = null;

function normalize(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function isInvalidAccountName(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().replace(/^@/, "");
  return /^\d{4}年\d{1,2}月精选作者$/.test(text)
    || /^(?:前往|打开|进入|查看|访问).{0,12}(?:作者|达人)主页$/.test(text)
    || /^(?:作者|达人)主页$/.test(text);
}

function creatorKey(accountName, platform = config.values?.platform || "抖音") {
  return `${normalize(platform)}:${normalize(accountName)}`;
}

async function runLark(args) {
  const cli = config.larkCliPath || "lark-cli";
  const { stdout } = await execFileAsync(cli, args, { maxBuffer: 10 * 1024 * 1024 });
  const envelope = JSON.parse(stdout);
  if (envelope.ok !== true) throw new Error(envelope.error?.message || "lark-cli 请求失败");
  return envelope.data;
}

function baseArgs(command) {
  return [
    "base",
    command,
    "--base-token", config.baseToken,
    "--table-id", config.tableId,
    "--as", config.identity || "user"
  ];
}

function rowsFromData(data) {
  const fields = data?.fields || [];
  const ids = data?.record_id_list || [];
  return (data?.data || []).map((row, index) => ({
    recordId: ids[index] || "",
    fields: Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]))
  }));
}

function firstCell(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function validateSchema() {
  const data = await runLark([...baseArgs("+field-list"), "--limit", "200", "--format", "json"]);
  const byName = new Map((data.fields || []).map((field) => [field.name, field]));
  for (const key of requiredFields) {
    const name = config.fields?.[key];
    if (!name || !byName.has(name)) throw new Error(`多维表格缺少配置字段：${name || key}`);
  }
  const platformField = byName.get(config.fields.platform);
  const statusField = byName.get(config.fields.status);
  const priorityField = byName.get(config.fields.priority);
  if (platformField.type !== "select" || statusField.type !== "select" || priorityField.type !== "select") {
    throw new Error("平台、状态和建联优先级字段必须是单选");
  }
  const platformOptions = (platformField.options || []).map((item) => item.name);
  const statusOptions = (statusField.options || []).map((item) => item.name);
  const priorityOptions = (priorityField.options || []).map((item) => item.name);
  if (!platformOptions.includes(config.values.platform)) throw new Error(`平台字段不存在选项：${config.values.platform}`);
  if (!statusOptions.includes(config.values.status)) throw new Error(`状态字段不存在选项：${config.values.status}`);
  for (const option of ["S级", "A级", "B级"]) {
    if (!priorityOptions.includes(option)) throw new Error(`建联优先级字段不存在选项：${option}`);
  }
  return {
    title: config.destination?.baseName || "贴片自动化",
    table: config.destination?.tableName || "数据表",
    view: config.destination?.viewName || "底表",
    fields: Object.fromEntries(requiredFields.map((key) => [key, config.fields[key]]))
  };
}

async function getSchema() {
  if (schemaCache && Date.now() - schemaCachedAt < CACHE_TTL_MS) return schemaCache;
  if (!schemaRefreshPromise) {
    schemaRefreshPromise = validateSchema()
      .then((schema) => {
        schemaCache = schema;
        schemaCachedAt = Date.now();
        return schema;
      })
      .finally(() => {
        schemaRefreshPromise = null;
      });
  }
  return schemaRefreshPromise;
}

async function searchExact(fieldName, value) {
  const selected = requiredFields.flatMap((key) => ["--field-id", config.fields[key]]);
  const data = await runLark([
    ...baseArgs("+record-search"),
    "--keyword", value,
    "--search-field", fieldName,
    ...selected,
    "--limit", "50",
    "--format", "json"
  ]);
  return rowsFromData(data).filter((row) => normalize(row.fields[fieldName]) === normalize(value));
}

async function searchDuplicates(accountName, videoUrl) {
  const [accountRows, videoRows] = await Promise.all([
    searchExact(config.fields.accountName, accountName),
    searchExact(config.fields.videoUrl, videoUrl)
  ]);
  const rows = [...accountRows, ...videoRows]
    .filter((row, index, items) => items.findIndex((item) => item.recordId === row.recordId) === index)
    .filter((row) => normalize(firstCell(row.fields[config.fields.platform])) === normalize(config.values.platform));
  return rows;
}

async function createCandidate(payload) {
  const fields = {
    [config.fields.platform]: config.values.platform,
    [config.fields.accountName]: payload.accountName,
    [config.fields.followers]: payload.followersText || String(payload.followers || ""),
    [config.fields.videoUrl]: payload.videoUrl,
    [config.fields.status]: config.values.status,
    [config.fields.priority]: payload.priority || "B级",
    [config.fields.note]: payload.note || ""
  };
  const data = await runLark([
    ...baseArgs("+record-upsert"),
    "--json", JSON.stringify(fields),
    "--format", "json"
  ]);
  return data?.record?.record_id || data?.record_id || data?.id || "";
}

async function upsertCandidate(payload) {
  if (!payload?.accountName || !payload?.videoUrl) throw new Error("候选账号缺少账号名称或视频链接");
  if (isInvalidAccountName(payload.accountName)) throw new Error(`拒绝写入页面导航文案：${payload.accountName}`);
  const matches = await searchDuplicates(payload.accountName, payload.videoUrl);
  if (matches.length) {
    return { ok: true, duplicate: true, created: false, recordId: matches[0].recordId };
  }
  const recordId = await createCandidate(payload);
  if (Array.isArray(indexCache)) {
    indexCache.push({
      key: creatorKey(payload.accountName, config.values.platform),
      recordId,
      accountName: payload.accountName,
      platform: config.values.platform
    });
    indexCachedAt = Date.now();
  }
  return { ok: true, duplicate: false, created: true, recordId };
}

async function listIndex() {
  const items = [];
  let offset = 0;
  do {
    const data = await runLark([
      ...baseArgs("+record-list"),
      "--field-id", config.fields.platform,
      "--field-id", config.fields.accountName,
      "--offset", String(offset),
      "--limit", "200",
      "--format", "json"
    ]);
    const rows = rowsFromData(data);
    for (const row of rows) {
      const accountName = row.fields[config.fields.accountName];
      const platform = firstCell(row.fields[config.fields.platform]);
      if (!accountName || normalize(platform) !== normalize(config.values.platform)) continue;
      items.push({ key: creatorKey(accountName, platform), recordId: row.recordId, accountName, platform });
    }
    if (!data.has_more || rows.length === 0) break;
    offset += rows.length;
  } while (offset < 100_000);
  return items;
}

async function getIndex() {
  if (Array.isArray(indexCache) && Date.now() - indexCachedAt < CACHE_TTL_MS) return indexCache;
  if (!indexRefreshPromise) {
    indexRefreshPromise = listIndex()
      .then((items) => {
        indexCache = items;
        indexCachedAt = Date.now();
        return items;
      })
      .finally(() => {
        indexRefreshPromise = null;
      });
  }
  return indexRefreshPromise;
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Douyin-Finder-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return json(response, 204, {});
  const expectedToken = String(config.token || "");
  if (expectedToken && request.headers["x-douyin-finder-token"] !== expectedToken) {
    return json(response, 401, { ok: false, error: "Bridge token 不正确" });
  }
  try {
    if (request.method === "GET" && request.url === "/health") {
      const schema = await getSchema();
      return json(response, 200, {
        ok: true,
        schema,
        destination: {
          baseName: config.destination?.baseName || schema.title,
          tableName: config.destination?.tableName || schema.table,
          viewName: config.destination?.viewName || schema.view,
          platform: config.values.platform,
          status: config.values.status
        }
      });
    }
    if (request.method === "GET" && request.url === "/api/index") {
      return json(response, 200, { ok: true, items: await getIndex() });
    }
    if (request.method === "POST" && request.url === "/api/candidates/upsert") {
      return json(response, 200, await upsertCandidate(await readBody(request)));
    }
    return json(response, 404, { ok: false, error: "接口不存在" });
  } catch (error) {
    return json(response, 500, { ok: false, error: error?.message || String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Douyin Finder Bridge listening on http://127.0.0.1:${port}`);
  Promise.allSettled([getSchema(), getIndex()]).then((results) => {
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) console.error(`Bridge 预热失败：${failures.map((item) => item.reason?.message || item.reason).join("；")}`);
    else console.log(`Bridge 已连接 ${config.destination?.baseName || "贴片自动化"}，缓存 ${indexCache?.length || 0} 个账号`);
  });
});
