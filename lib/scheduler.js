import { numericValue } from "./numeric.js";

function parseTimeSlot(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, hour, minute };
}

export function validScheduleSlots(schedule = {}) {
  const weekdays = [...new Set((schedule.weekdays || [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  const times = [...new Map((schedule.times || [])
    .map(parseTimeSlot)
    .filter(Boolean)
    .map((slot) => [slot.value, slot])).values()]
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);
  return { weekdays, times };
}

export function nextScheduledOccurrence(schedule = {}, fromMs = Date.now()) {
  if (schedule.enabled === false) return null;
  const from = Number(fromMs);
  if (!Number.isFinite(from)) return null;
  const { weekdays, times } = validScheduleSlots(schedule);
  if (!weekdays.length || !times.length) return null;
  const allowedDays = new Set(weekdays);
  const start = new Date(from);

  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    if (!allowedDays.has(day.getDay())) continue;
    for (const slot of times) {
      const candidate = new Date(day);
      candidate.setHours(slot.hour, slot.minute, 0, 0);
      if (candidate.getTime() >= from) {
        return { scheduledTime: candidate.getTime(), weekday: candidate.getDay(), time: slot.value };
      }
    }
  }
  return null;
}

export function validateSchedule(schedule = {}) {
  const problems = [];
  const { weekdays, times } = validScheduleSlots(schedule);
  if (schedule.enabled !== false && weekdays.length === 0) problems.push("定时计划至少需要一个星期选项");
  if (schedule.enabled !== false && times.length === 0) problems.push("定时计划至少需要一个有效时间");
  const lateToleranceMinutes = numericValue(schedule.lateToleranceMinutes);
  if (schedule.enabled !== false && (!Number.isFinite(lateToleranceMinutes) || lateToleranceMinutes < 0 || lateToleranceMinutes > 60)) {
    problems.push("定时任务允许延迟启动的时间必须在 0–60 分钟之间");
  }
  return problems;
}
