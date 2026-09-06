export const STALL_GRACE_MS = 15_000;

export function stepBudget(phase, settings = {}, waitUntil = null, now = Date.now()) {
  switch (phase) {
    case "read": return 15_000;
    case "profile": return Math.max(1, Math.min(5, Number(settings.panelRecoveryAttempts) || 3)) * 40_000;
    case "dwell": {
      if (!Number.isFinite(waitUntil) || waitUntil < now - 600_000 || waitUntil > now + 300_000) throw new Error("无效的等待截止时间");
      return Math.max(0, waitUntil - now);
    }
    case "submit": return 45_000;
    case "transition": return 45_000;
    case "idle": return 10_000;
    default: throw new Error("未知的运行步骤");
  }
}

export function runtimeStalled(runtime, now = Date.now()) {
  return Number.isFinite(runtime?.deadlineAt) && now > runtime.deadlineAt + STALL_GRACE_MS;
}

// The worker owns these timers. Cancel resolves outstanding message channels so
// an old page generation cannot continue when a replacement loop starts.
export function createRunWaits({ now = Date.now, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const pending = new Set();
  return {
    wait(until) {
      if (!Number.isFinite(until) || until > now() + 300_000) throw new Error("无效的等待截止时间");
      return new Promise((resolve) => {
        const entry = { timer: null, finish: (ok) => { unschedule(entry.timer); pending.delete(entry); resolve({ ok, wokeAt: now() }); } };
        pending.add(entry);
        // Recheck wall time on wake rather than assuming the timer fired on time.
        const wake = () => {
          if (until > now()) entry.timer = schedule(wake, Math.min(30_000, until - now()));
          else entry.finish(true);
        };
        entry.timer = schedule(wake, Math.max(0, Math.min(30_000, until - now())));
      });
    },
    cancel() { for (const entry of [...pending]) entry.finish(false); },
    get size() { return pending.size; }
  };
}

export function withTimeout(promise, milliseconds, message = "页面响应超时") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}
