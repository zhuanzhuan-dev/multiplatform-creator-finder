import { useState } from "react";
import { errorMessage } from "./error-message";
import { sendRuntime } from "./chrome-runtime";
import { decisionMeta, decisionMetricLine, formatRelativeTime } from "../sidepanel/format";
import type { Decision } from "../sidepanel/types";

type HistoryResponse = { ok: boolean; items: Decision[]; total: number };

export function AccountVideosControl({ decision, now = Date.now() }: { decision: Decision; now?: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Decision[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const canInspect = decision.sourcePlatform !== "xingtu" && Boolean(decision.authorId || decision.profileUrl || decision.videoId);
  if (!canInspect) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || items) return;
    if (!decision.authorId && !decision.profileUrl) {
      setItems([decision]);
      setCount(1);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await sendRuntime<HistoryResponse>({
        type: "DRA_QUERY_HISTORY",
        options: {
          sourcePlatform: decision.sourcePlatform || "",
          authorId: decision.authorId || "",
          profileUrl: decision.authorId ? "" : (decision.profileUrl || ""),
          limit: 100
        }
      });
      const unique = new Map<string, Decision>();
      for (const item of response.items || []) {
        const id = item.videoId || item.id || `${item.occurredAt}-${item.caption}`;
        if (!unique.has(id)) unique.set(id, item);
      }
      const list = [...unique.values()];
      if (!list.length && (decision.videoId || decision.plays != null || decision.likes != null)) list.push(decision);
      setItems(list);
      setCount(Math.max(response.total || 0, list.length));
    } catch (err) {
      setError(errorMessage(err));
      setItems(decision.videoId || decision.plays != null ? [decision] : []);
      setCount(1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`account-video-details ${open ? "open" : ""}`}>
      <button
        type="button"
        className={`account-video-badge ${open ? "open" : ""}`}
        aria-expanded={open}
        title="查看该账号近 24 小时采集到的视频"
        onClick={() => void toggle()}
      >
        视频{count != null ? ` ${count}` : ""}
      </button>
      {open ? (
        <div className="account-video-panel" role="region" aria-label={`${decision.accountName || "账号"}采集视频`}>
          {loading ? <p className="field-note">正在读取该账号视频…</p> : null}
          {error ? <p className="message error">{error}</p> : null}
          {!loading && items?.length === 0 ? <p className="field-note">暂无带指标的视频记录。</p> : null}
          {items?.map((video, index) => (
            <article className="account-video-card" key={`${decision.authorId || decision.profileUrl}-${video.videoId || video.id || index}`}>
              {video.coverUrl ? <img className="account-video-cover" src={video.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
              <div className="account-video-body">
                <p className="account-video-title">
                  {video.beforeUrl
                    ? <a href={video.beforeUrl} target="_blank" rel="noreferrer">{video.caption || video.videoId || "未命名视频"}</a>
                    : (video.caption || video.videoId || "未命名视频")}
                </p>
                <p className="field-note">{decisionMetricLine(video)}</p>
                <p className="field-note">{decisionMeta(video.code).label} · {formatRelativeTime(video.occurredAt, now)}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
