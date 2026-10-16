const { fail, zone } = require("./domain");
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(date));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
function localDate(date, timezone) {
  const p = localParts(date, timezone);
  return p.year + "-" + p.month + "-" + p.day;
}
function addDays(date, days) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
function toUtc(local, timezone) {
  zone(timezone);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) fail("Data local inválida.");
  const wanted = Date.parse(local + ":00Z");
  if (!Number.isFinite(wanted)) fail("Data inválida.");
  let guess = wanted;
  for (let i = 0; i < 4; i++) {
    const p = localParts(guess, timezone);
    const observed = Date.parse(
      p.year +
        "-" +
        p.month +
        "-" +
        p.day +
        "T" +
        p.hour +
        ":" +
        p.minute +
        ":" +
        p.second +
        "Z",
    );
    guess += wanted - observed;
  }
  const p = localParts(guess, timezone);
  if (
    p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute !==
    local
  )
    fail("Horário inexistente nesse fuso.");
  return new Date(guess).toISOString();
}
function nextOccurrence(rule, after) {
  const timezone = zone(rule.timezone);
  const start = rule.start_date || localDate(after, timezone);
  const days = JSON.parse(rule.specific_days || "[]");
  let date = localDate(after, timezone);
  for (let i = 0; i < 740; i++, date = addDays(date, 1)) {
    if (date < start) continue;
    if (rule.recurrence === "ONCE" && date !== start) {
      if (date > start) return null;
      continue;
    }
    const diff = Math.round(
      (Date.parse(date + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) /
        86400000,
    );
    if (rule.recurrence === "EVERY_OTHER_DAY" && diff % 2 !== 0) continue;
    if (
      rule.recurrence === "SPECIFIC_DAYS" &&
      !days.includes(
        ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
          new Date(date + "T12:00:00Z").getUTCDay()
        ],
      )
    )
      continue;
    let candidate;
    try {
      candidate = toUtc(date + "T" + rule.time_of_day, timezone);
    } catch {
      continue;
    }
    if (Date.parse(candidate) > Number(new Date(after))) return candidate;
  }
  return null;
}
module.exports = { localParts, localDate, addDays, toUtc, nextOccurrence };
