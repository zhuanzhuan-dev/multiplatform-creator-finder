import { officialAiHintText } from "./footage-frame.js";

export const AI_GENERATED_ACTIONS = Object.freeze(["short-dwell", "skip", "not-interested"]);

export function emptyAiGenerated() {
  return { seen: 0, hits: 0, switched: false, ids: [], byId: {}, marked: [] };
}

export function normalizeAiGeneratedAction(value) {
  return AI_GENERATED_ACTIONS.includes(value) ? value : "short-dwell";
}

function clampAiDwell(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 1) return 5;
  return Math.min(300, seconds);
}

// 本轮已经看过的推荐卡片里，官方 AI 声明占比超过一半。等于一半不切换。
export function aiGeneratedSwitched(counter) {
  const seen = Number(counter?.seen) || 0;
  const hits = Number(counter?.hits) || 0;
  return seen > 0 && hits / seen > 0.5;
}

export function aiGeneratedEffect(counter, fingerprint, configuredAction) {
  const key = String(fingerprint || "");
  if (!key || !counter?.byId?.[key]?.hit) return null;
  if (aiGeneratedSwitched(counter)) return "not-interested";
  return normalizeAiGeneratedAction(configuredAction);
}

// 同一条卡片只计一次。先计入当前卡片，再决定它自己要不要点不感兴趣。
export function recordAiGenerated(current, input = {}) {
  const hint = officialAiHintText(input.hint);
  const key = String(input.fingerprint || "");
  const counter = {
    seen: Number(current?.seen) || 0,
    hits: Number(current?.hits) || 0,
    switched: false,
    ids: Array.isArray(current?.ids) ? current.ids.slice(-5000) : [],
    byId: current?.byId && typeof current.byId === "object" ? { ...current.byId } : {},
    marked: Array.isArray(current?.marked) ? current.marked.slice(-5000) : [],
  };
  if (key && !counter.ids.includes(key)) {
    counter.ids.push(key);
    if (counter.ids.length > 5000) {
      const dropped = counter.ids.shift();
      if (dropped) delete counter.byId[dropped];
    }
    counter.seen += 1;
    if (hint) {
      counter.hits += 1;
      counter.byId[key] = { hit: true };
    }
  }
  counter.switched = aiGeneratedSwitched(counter);
  const action = aiGeneratedEffect(counter, key, input.action);
  return {
    counter,
    hit: Boolean(action),
    action,
    dwellSeconds: action === "short-dwell" ? clampAiDwell(input.dwellSeconds) : 0,
  };
}

export function aiGeneratedStatusText(counter) {
  const seen = Number(counter?.seen) || 0;
  const hits = Number(counter?.hits) || 0;
  const text = `${hits}/${seen}`;
  return aiGeneratedSwitched(counter) ? `${text}，已自动改为不感兴趣` : text;
}
