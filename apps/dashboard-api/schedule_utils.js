function safeTimeZone(tz) {
  if (!tz || typeof tz !== "string") return null;
  const v = tz.trim();
  if (!v) return null;
  try {
    // Throws on unknown time zone names.
    new Intl.DateTimeFormat("en-US", { timeZone: v }).format(new Date());
    return v;
  } catch {
    return null;
  }
}

function getZonedParts(date, timeZone) {
  const tz = safeTimeZone(timeZone) || "UTC";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const out = {};
  for (const p of parts) {
    if (p.type === "year") out.year = Number.parseInt(p.value, 10);
    if (p.type === "month") out.month = Number.parseInt(p.value, 10);
    if (p.type === "day") out.day = Number.parseInt(p.value, 10);
    if (p.type === "hour") out.hour = Number.parseInt(p.value, 10);
    if (p.type === "minute") out.minute = Number.parseInt(p.value, 10);
    if (p.type === "second") out.second = Number.parseInt(p.value, 10);
  }
  return out;
}

function zonedTimeToUtc({ year, month, day, hour, minute, second }, timeZone) {
  const tz = safeTimeZone(timeZone) || "UTC";
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0, 0);
  let guess = desiredUtc;

  // Iteratively adjust for time zone offset / DST.
  for (let i = 0; i < 4; i++) {
    const actualParts = getZonedParts(new Date(guess), tz);
    const actualUtc = Date.UTC(
      actualParts.year,
      (actualParts.month || 1) - 1,
      actualParts.day || 1,
      actualParts.hour || 0,
      actualParts.minute || 0,
      actualParts.second || 0,
      0
    );
    const diff = desiredUtc - actualUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

function parseTimeOfDayToMinutes(value) {
  const s = typeof value === "string" ? value.trim() : "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTimeOfDay(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function uniqueSortedMinutes(list) {
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const mm = ((Math.round(n) % 1440) + 1440) % 1440;
    const k = String(mm);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(mm);
  }
  out.sort((a, b) => a - b);
  return out;
}

function minutesListFromConfig(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const mode = typeof cfg.mode === "string" ? cfg.mode : "interval";

  if (mode === "daily_times") {
    const times = Array.isArray(cfg.times) ? cfg.times : [];
    const mins = [];
    for (const t of times) {
      const v = parseTimeOfDayToMinutes(String(t || ""));
      if (v != null) mins.push(v);
    }
    return uniqueSortedMinutes(mins);
  }

  if (mode === "times_per_day") {
    const countRaw = cfg.count != null ? Number.parseInt(String(cfg.count), 10) : null;
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(24, countRaw)) : null;
    const start = parseTimeOfDayToMinutes(String(cfg.startTime || ""));
    const end = parseTimeOfDayToMinutes(String(cfg.endTime || ""));
    if (!count || start == null) return [];

    const windowMinutes = end != null ? ((end - start + 1440) % 1440) : 0;
    const span = windowMinutes > 0 ? windowMinutes : 1440;
    const step = span / count;
    const mins = [];
    for (let i = 0; i < count; i++) {
      mins.push(start + i * step);
    }
    return uniqueSortedMinutes(mins);
  }

  return [];
}

function daysOfWeekFromConfig(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const raw = Array.isArray(cfg.daysOfWeek) ? cfg.daysOfWeek : [];
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    const n = Number.parseInt(String(v), 10);
    // ISO: 1=Mon ... 7=Sun
    if (!Number.isFinite(n) || n < 1 || n > 7) continue;
    const k = String(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

function minutesListFromTimesArray(times) {
  const mins = [];
  for (const t of times) {
    const v = parseTimeOfDayToMinutes(String(t || ""));
    if (v != null) mins.push(v);
  }
  return uniqueSortedMinutes(mins);
}

function computeNextRunAt({ now = new Date(), intervalSeconds, config, timezone }) {
  const cfg = config && typeof config === "object" ? config : {};
  const mode = typeof cfg.mode === "string" ? cfg.mode : "interval";
  const tz = safeTimeZone(timezone) || "UTC";

  if (mode === "interval" || intervalSeconds) {
    const sec = Number.parseInt(String(intervalSeconds || 0), 10);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return new Date(now.getTime() + sec * 1000);
  }

  const z = getZonedParts(now, tz);
  const isoDow = ((new Date(Date.UTC(z.year, z.month - 1, z.day)).getUTCDay() + 6) % 7) + 1; // 1..7

  if (mode === "weekly_times") {
    const days = daysOfWeekFromConfig(cfg);
    const times = minutesListFromTimesArray(Array.isArray(cfg.times) ? cfg.times : []);
    if (!days.length || !times.length) return null;

    // Search next 8 local days for the earliest matching time.
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      const dayIso = ((isoDow - 1 + dayOffset) % 7) + 1;
      if (!days.includes(dayIso)) continue;

      // Move to that local day by jumping ~36h/dayOffset and reading zoned date parts.
      const approx = new Date(now.getTime() + dayOffset * 36 * 60 * 60 * 1000);
      const zp = getZonedParts(approx, tz);
      const ymd = { year: zp.year, month: zp.month, day: zp.day };

      for (const mins of times) {
        const hour = Math.floor(mins / 60);
        const minute = mins % 60;
        const candidate = zonedTimeToUtc({ ...ymd, hour, minute, second: 0 }, tz);
        if (candidate.getTime() > now.getTime() + 1000) return candidate;
      }
    }
    return null;
  }

  const minutesList = minutesListFromConfig(cfg);
  if (!minutesList.length) return null;

  const ymd = { year: z.year, month: z.month, day: z.day };

  for (const mins of minutesList) {
    const hour = Math.floor(mins / 60);
    const minute = mins % 60;
    const candidate = zonedTimeToUtc({ ...ymd, hour, minute, second: 0 }, tz);
    if (candidate.getTime() > now.getTime() + 1000) return candidate;
  }

  // Try next local day (36h jump ensures we cross local midnight even with DST).
  const nextApprox = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const z2 = getZonedParts(nextApprox, tz);
  const ymd2 = { year: z2.year, month: z2.month, day: z2.day };
  const first = minutesList[0];
  const hour = Math.floor(first / 60);
  const minute = first % 60;
  return zonedTimeToUtc({ ...ymd2, hour, minute, second: 0 }, tz);
}

function normalizeScheduleInput(scheduleInput) {
  const s = scheduleInput && typeof scheduleInput === "object" ? scheduleInput : null;
  if (!s) return null;

  const enabled = s.enabled === false ? false : true;
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Session schedule";
  const timezone = safeTimeZone(s.timezone) || null;
  const config = s.config && typeof s.config === "object" ? s.config : {};

  let intervalSeconds = null;
  if (s.intervalSeconds === null) intervalSeconds = null;
  else if (s.intervalSeconds != null) {
    const raw = Number.parseInt(String(s.intervalSeconds), 10);
    intervalSeconds = Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  // Default mode is interval when intervalSeconds is present.
  if (!config.mode && intervalSeconds) config.mode = "interval";

  const startAtIso = typeof s.startAt === "string" && s.startAt.trim() ? s.startAt.trim() : null;
  const startAt = startAtIso ? new Date(startAtIso) : null;
  let nextRunAt = null;

  if (startAt && !Number.isNaN(startAt.getTime())) {
    nextRunAt = startAt;
  } else {
    nextRunAt = computeNextRunAt({ now: new Date(), intervalSeconds, config, timezone });
  }

  // Validation by mode.
  const mode = typeof config.mode === "string" ? config.mode : "interval";
  if (mode === "interval") {
    if (!intervalSeconds) return { ok: false, error: "missing intervalSeconds" };
  } else {
    if (mode === "weekly_times") {
      const days = daysOfWeekFromConfig(config);
      const times = minutesListFromTimesArray(Array.isArray(config.times) ? config.times : []);
      if (!days.length || !times.length) return { ok: false, error: "invalid schedule config" };
    } else {
      const list = minutesListFromConfig(config);
      if (!list.length) return { ok: false, error: "invalid schedule config" };
    }
  }
  if (!nextRunAt || Number.isNaN(nextRunAt.getTime())) return { ok: false, error: "invalid nextRunAt" };

  return { ok: true, schedule: { enabled, intervalSeconds, timezone, name, config, nextRunAt } };
}

module.exports = {
  safeTimeZone,
  computeNextRunAt,
  minutesListFromConfig,
  minutesToTimeOfDay,
  daysOfWeekFromConfig,
  normalizeScheduleInput,
};
