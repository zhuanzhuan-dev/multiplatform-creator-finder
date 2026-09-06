import test from "node:test";
import assert from "node:assert/strict";
import { beijingDay, recordDailyScan, dailySnapshot } from "./daily-stats.js";

test("daily totals survive serialization, deduplicate, and roll over at Beijing midnight", () => {
  const before = Date.parse("2026-09-06T15:59:59Z");
  const after = before + 1000;
  let data = recordDailyScan(null, "video-1", before);
  data = recordDailyScan(JSON.parse(JSON.stringify(data)), "video-1", before);
  data = recordDailyScan(data, "video-2", before);
  assert.deepEqual(dailySnapshot(data, before), { date: "2026-09-06", scanned: 2 });
  assert.deepEqual(dailySnapshot(data, after), { date: "2026-09-07", scanned: 0 });
  data = recordDailyScan(data, "video-1", after);
  assert.equal(dailySnapshot(data, after).scanned, 1);
  assert.equal(data.days["2026-09-06"].scanned, 2);
  assert.equal(beijingDay(after), "2026-09-07");
});

test("retain only 30 daily aggregates and current-day identities", () => {
  let data;
  const start = Date.parse("2026-08-01T00:00:00Z");
  for (let i = 0; i < 40; i++) data = recordDailyScan(data, `item-${i}`, start + i * 86400000);
  assert.equal(Object.keys(data.days).length, 30);
  assert.deepEqual(data.seen, ["item-39"]);
});
