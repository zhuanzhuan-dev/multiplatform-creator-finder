import type { RunState } from "./types";

export function RadarDisplay({ state }: { state: RunState }) {
  const status = state.status || "idle";
  const scanned = Number(state.stats?.scanned || 0);
  const pulse = state.lastDecision?.code?.includes("ACCEPTED") ? "hit" : state.lastTickAt ? "scan" : "idle";
  return (
    <div className={`radar-display ${status} ${pulse}`} role="img" aria-label={`扫描雷达：${status === "running" ? `正在处理第 ${scanned + 1} 条视频` : "当前未扫描"}`}>
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <defs>
          <radialGradient id="radarCore" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="currentColor" stopOpacity=".82" />
            <stop offset=".28" stopColor="currentColor" stopOpacity=".18" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="radarSweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".72" />
          </linearGradient>
        </defs>
        <circle className="radar-field" cx="44" cy="44" r="41" />
        <circle className="radar-ring ring-outer" cx="44" cy="44" r="32" />
        <circle className="radar-ring ring-inner" cx="44" cy="44" r="20" />
        <path className="radar-axis" d="M44 5V83M5 44H83M16.4 16.4l55.2 55.2M71.6 16.4L16.4 71.6" />
        <path className="radar-sweep" d="M44 44V5A39 39 0 0 1 71.6 16.4Z" fill="url(#radarSweep)" />
        <circle className="radar-core-glow" cx="44" cy="44" r="18" fill="url(#radarCore)" />
        <circle className="radar-core" cx="44" cy="44" r="3.2" />
        <circle className="radar-blip blip-one" cx="61" cy="25" r="2.2" />
        <circle className="radar-blip blip-two" cx="26" cy="56" r="1.8" />
        <circle className="radar-blip blip-three" cx="58" cy="63" r="1.6" />
      </svg>
      <span className="radar-index">{String(scanned).padStart(2, "0")}</span>
    </div>
  );
}
