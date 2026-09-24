import { DOUYIN_RECOMMEND_URL } from "../../lib/platform-routes.js";

export { DOUYIN_RECOMMEND_URL };

export type PlatformId = "douyin" | "kuaishou" | "feigua" | "bilibili" | "xingtu";
export type SurfaceId = "recommend" | "featured" | "creator" | "video" | "library" | "popular" | "market" | "unknown";

export interface RouteContext {
  platform: PlatformId;
  surface: SurfaceId;
  label: string;
  runnable: boolean;
  url: URL;
}

export interface TabRouteCandidate {
  windowId?: number;
  url?: string;
  pendingUrl?: string;
}

interface PlatformRoute {
  platform: PlatformId;
  hostnames: readonly string[];
  classify(url: URL): Omit<RouteContext, "platform" | "url">;
}

const PLATFORM_ROUTES: readonly PlatformRoute[] = [
  {
    platform: "douyin",
    hostnames: ["www.douyin.com"],
    classify(url) {
      if (url.pathname.startsWith("/user/")) return { surface: "creator", label: "抖音达人主页", runnable: false };
      if (url.pathname.startsWith("/video/")) return { surface: "video", label: "抖音视频详情", runnable: false };
      if (url.pathname === "/" && url.searchParams.get("recommend") === "1") {
        return { surface: "recommend", label: "抖音推荐", runnable: true };
      }
      if (url.pathname === "/") return { surface: "featured", label: "抖音精选", runnable: false };
      return { surface: "unknown", label: "抖音其他页面", runnable: false };
    }
  },
  {
    platform: "kuaishou",
    hostnames: ["www.kuaishou.com"],
    classify: url => url.pathname === '/new-reco'
      ? {surface:'recommend',label:'快手推荐',runnable:true}
      : {surface:url.pathname.startsWith('/profile/')?'creator':'unknown',label:'快手：请打开推荐页',runnable:false}
  },
  {
    platform: "feigua",
    hostnames: ["www.feigua.cn", "dy.feigua.cn"],
    classify: (url) => url.hostname === "dy.feigua.cn" && url.pathname === "/app/" && /^#\/video\/library\/all(?:[?]|$)/.test(url.hash)
      ? { surface: "library", label: "飞瓜视频库", runnable: true }
      : /^#\/video-detail\/index(?:[?]|$)/.test(url.hash) ? {surface:'video',label:'飞瓜视频详情',runnable:false}
      : /^#\/blogger-detail\/index(?:[?]|$)/.test(url.hash) ? {surface:'creator',label:'飞瓜达人详情',runnable:false}
      : { surface: "unknown", label: "飞瓜：请打开视频库", runnable: false }
  },
  {
    platform: "bilibili",
    hostnames: ["www.bilibili.com"],
    classify(url) {
      if (url.pathname.startsWith("/video/")) return { surface: "video", label: "B站视频详情", runnable: false };
      if (url.pathname === "/v/popular/all" || url.pathname.startsWith("/v/popular/all")) {
        return { surface: "popular", label: "B站综合热门", runnable: true };
      }
      if (url.pathname === "/" || url.pathname === "") {
        return { surface: "recommend", label: "B站首页推荐", runnable: true };
      }
      return { surface: "unknown", label: "B站：请打开首页或综合热门", runnable: false };
    }
  },
  {
    platform: "xingtu",
    hostnames: ["www.xingtu.cn", "xingtu.cn"],
    classify(url) {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const hash = (url.hash.split("?")[0] || "").replace(/^#/, "");
      if (path === "/ad/creator/market" || path.startsWith("/ad/creator/market/") || hash === "/ad/creator/market" || hash.startsWith("/ad/creator/market")) {
        return { surface: "market", label: "星图达人广场", runnable: true };
      }
      if (/^\/ad\/creator\/(?:author-homepage\/douyin-video|author(?:\/douyin)?)\/\d+$/.test(path) || /^\/ad\/creator\/(?:author-homepage\/douyin-video|author(?:\/douyin)?)\/\d+$/.test(hash)) {
        return { surface: "creator", label: "星图达人主页", runnable: false };
      }
      return { surface: "unknown", label: "星图：请打开达人广场", runnable: false };
    }
  }
];

export function resolveRoute(input: string | URL): RouteContext | null {
  try {
    const url = input instanceof URL ? input : new URL(input);
    if (url.protocol !== "https:") return null;
    const platform = PLATFORM_ROUTES.find((candidate) => candidate.hostnames.includes(url.hostname));
    if (!platform) return null;
    return { platform: platform.platform, url, ...platform.classify(url) };
  } catch {
    return null;
  }
}

export function isRunnableRoute(input: string | URL): boolean {
  return resolveRoute(input)?.runnable === true;
}

export function firstRunnableTabInWindow<T extends TabRouteCandidate>(tabs: readonly T[], windowId: number): T | null {
  return tabs.find((tab) => tab.windowId === windowId && isRunnableRoute(tab.pendingUrl || tab.url || "")) || null;
}

export function launchUrl(platform: PlatformId, surface: SurfaceId): string {
  if (platform === "kuaishou" && surface === "recommend") return "https://www.kuaishou.com/new-reco";
  if (platform === "feigua" && surface === "library") return "https://dy.feigua.cn/app/#/video/library/all";
  if (platform === "bilibili" && surface === "recommend") return "https://www.bilibili.com/";
  if (platform === "bilibili" && surface === "popular") return "https://www.bilibili.com/v/popular/all";
  if (platform === "xingtu" && surface === "market") return "https://www.xingtu.cn/ad/creator/market";
  if (platform === "douyin" && surface === "recommend") {
    return DOUYIN_RECOMMEND_URL;
  }
  throw new Error(`尚未配置启动路由：${platform}/${surface}`);
}
