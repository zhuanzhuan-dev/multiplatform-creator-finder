export function beijingDay(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Keep 30 daily totals and only today's identities, independent of run resets.
export function recordDailyScan(saved, fingerprint, now = Date.now()) {
  const day = beijingDay(now);
  const data = saved?.version === 1 ? saved : { version: 1, days: {}, day, seen: [] };
  if (data.day !== day) { data.day = day; data.seen = []; }
  if (!fingerprint || data.seen.includes(fingerprint)) return data;
  data.seen.push(fingerprint);
  data.days[day] = { scanned: Number(data.days[day]?.scanned || 0) + 1 };
  for (const key of Object.keys(data.days).sort().slice(0, -30)) delete data.days[key];
  return data;
}

export function dailySnapshot(saved, now = Date.now()) {
  const date = beijingDay(now);
  return { date, scanned: Number(saved?.days?.[date]?.scanned || 0) };
}
