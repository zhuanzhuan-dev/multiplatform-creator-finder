import { useEffect, useMemo, useState } from "react";
import { decisionMeta, decisionsFor, formatLocalDateTime } from "../sidepanel/format";
import type { Decision, RunState } from "../sidepanel/types";

const STATE_KEY = "draState";
type Filter = "all" | "good" | "review" | "reject";

function matchesQuery(decision: Decision, query: string): boolean {
  if (!query) return true;
  return [decision.accountName, decision.code, ...(decision.reasons || [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(query);
}

function DecisionAvatar({ decision }: { decision: Decision }) {
  const [failed, setFailed] = useState(false);
  const initial = (decision.accountName || "?").trim().slice(0, 1).toUpperCase();
  if (!decision.avatarUrl || failed) return <span className="avatar-fallback" aria-hidden="true">{initial}</span>;
  return <img src={decision.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function DecisionsPage() {
  const [state, setState] = useState<RunState | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let active = true;
    void chrome.storage.local.get(STATE_KEY).then((stored) => {
      if (active) setState((stored[STATE_KEY] || {}) as RunState);
    });
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && changes[STATE_KEY]?.newValue) setState(changes[STATE_KEY].newValue as RunState);
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, []);

  const decisions = useMemo(() => decisionsFor(state || {}), [state]);
  const counts = useMemo(() => decisions.reduce((result, decision) => {
    result[decisionMeta(decision.code).tone as Exclude<Filter, "all">] += 1;
    return result;
  }, { good: 0, review: 0, reject: 0 }), [decisions]);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visible = useMemo(() => decisions.filter((decision) => {
    const tone = decisionMeta(decision.code).tone;
    return (filter === "all" || tone === filter) && matchesQuery(decision, normalizedQuery);
  }), [decisions, filter, normalizedQuery]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">DISCOVERY / DECISION LOG</p>
          <h1>本轮判断记录</h1>
          <p className="subtitle">查看自动找号助手在当前任务中做出的每一次判断。</p>
        </div>
        <span className={`run-status ${state?.status || "idle"}`}>{state?.status === "running" ? "实时更新中" : "本轮记录"}</span>
      </header>

      <section className="decision-rail" aria-label="判断结果汇总">
        <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}><span>全部判断</span><strong>{decisions.length}</strong></button>
        <button className={`good ${filter === "good" ? "selected" : ""}`} onClick={() => setFilter("good")}><span>规则命中</span><strong>{counts.good}</strong></button>
        <button className={`review ${filter === "review" ? "selected" : ""}`} onClick={() => setFilter("review")}><span>需复核</span><strong>{counts.review}</strong></button>
        <button className={`reject ${filter === "reject" ? "selected" : ""}`} onClick={() => setFilter("reject")}><span>淘汰与跳过</span><strong>{counts.reject}</strong></button>
      </section>

      <section className="ledger" aria-labelledby="ledgerTitle">
        <div className="ledger-toolbar">
          <div><h2 id="ledgerTitle">判断台账</h2><span>当前显示 {visible.length} 条</span></div>
          <label>
            <span className="visually-hidden">搜索账号或原因</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号、结果或原因" type="search" />
          </label>
        </div>

        {state === null ? <p className="empty-state">正在读取判断记录…</p> : visible.length === 0 ? (
          <p className="empty-state">没有符合当前筛选条件的记录。</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>时间</th><th>账号</th><th>判断结果</th><th>判断依据</th><th><span className="visually-hidden">操作</span></th></tr></thead>
              <tbody>
                {visible.map((decision, index) => {
                  const meta = decisionMeta(decision.code);
                  return (
                    <tr key={`${decision.occurredAt || "decision"}-${index}`}>
                      <td data-label="时间"><time dateTime={decision.occurredAt || ""}>{formatLocalDateTime(decision.occurredAt)}</time></td>
                      <td data-label="账号"><span className="creator"><DecisionAvatar decision={decision} /><strong>{decision.accountName || "未识别账号"}</strong></span></td>
                      <td data-label="判断结果"><span className={`decision-badge ${meta.tone}`}>{meta.label}</span></td>
                      <td data-label="判断依据" className="reason">{decision.reasons?.length ? decision.reasons.join(" · ") : decision.code || "已完成判断"}</td>
                      <td className="row-action">{decision.profileUrl ? <a href={decision.profileUrl} target="_blank" rel="noreferrer">查看主页 ↗</a> : <span>—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
