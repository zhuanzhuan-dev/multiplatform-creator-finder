import { md5Hex } from "./bilibili-md5.js";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52
];

function mixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join("").slice(0, 32);
}

function keyFromUrl(url) {
  const name = String(url || "").split("/").pop() || "";
  return name.slice(0, name.lastIndexOf(".")) || name;
}

/** @type {{img_key:string,sub_key:string,fetchedAt:number}|null} */
let cachedKeys = null;

export async function getWbiKeys(fetchImpl = fetch) {
  if (cachedKeys && Date.now() - cachedKeys.fetchedAt < 6 * 60 * 60 * 1000) {
    return { img_key: cachedKeys.img_key, sub_key: cachedKeys.sub_key };
  }
  const response = await fetchImpl("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" });
  if (!response.ok) throw new Error(`读取 B 站登录态失败（HTTP ${response.status}）`);
  const json = await response.json();
  const img = json?.data?.wbi_img?.img_url;
  const sub = json?.data?.wbi_img?.sub_url;
  if (!img || !sub) throw new Error("B 站 wbi 密钥不可用，请刷新首页后重试");
  cachedKeys = { img_key: keyFromUrl(img), sub_key: keyFromUrl(sub), fetchedAt: Date.now() };
  return { img_key: cachedKeys.img_key, sub_key: cachedKeys.sub_key };
}

export async function encWbi(params, fetchImpl = fetch) {
  const { img_key, sub_key } = await getWbiKeys(fetchImpl);
  const key = mixinKey(img_key + sub_key);
  const wts = Math.round(Date.now() / 1000);
  const signed = { ...params, wts };
  const query = Object.keys(signed)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(signed[name]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  return { ...signed, w_rid: md5Hex(query + key) };
}

export function resetWbiCache() {
  cachedKeys = null;
}

export function encodeWbiWithKeys(params, keys, now = Date.now()) {
  const key = mixinKey(keys.img_key + keys.sub_key);
  const wts = Math.round(now / 1000);
  const signed = { ...params, wts };
  const query = Object.keys(signed)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(signed[name]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  return { ...signed, w_rid: md5Hex(query + key) };
}
