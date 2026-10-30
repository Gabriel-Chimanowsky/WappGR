const { id, utc, text, zone, fail } = require("./domain");
const { nextOccurrence, localDate } = require("./time");
const official = require("./official-policy");
class Scheduler {
  constructor(db, campaigns, { now = Date.now } = {}) {
    this.db = db;
    this.campaigns = campaigns;
    this.now = now;
  }
  create(body, scheduleId = null) {
    const active = body.active === false || body.active === 0 ? 0 : 1;
    const messageConfig = official.validateMessage(this.db, body, {
      required: !!active,
      now: this.now(),
    });
    const recurrence = body.recurrence || "DAILY";
    if (
      !["DAILY", "EVERY_OTHER_DAY", "SPECIFIC_DAYS", "ONCE"].includes(
        recurrence,
      )
    )
      fail("Recorrência inválida.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.timeOfDay || ""))
      fail("Horário inválido.");
    const timezone = zone(body.timezone || "America/Sao_Paulo");
    const days = body.specificDays || [];
    if (
      !Array.isArray(days) ||
      days.some(
        (d) => !["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].includes(d),
      ) ||
      (recurrence === "SPECIFIC_DAYS" && !days.length)
    )
      fail("Dias da semana inválidos.");
    const startDate = body.startDate || localDate(this.now(), timezone);
    if (!/^\d{4}-\d\d-\d\d$/.test(startDate)) fail("Data inicial inválida.");
    const date = new Date(startDate + "T00:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== startDate
    )
      fail("Data inicial inválida.");
    let categoryId = body.categoryId || null;
    if (!categoryId && body.categoryFilter && body.categoryFilter !== "TODOS")
      categoryId =
        this.db
          .prepare("SELECT id FROM categories WHERE name=?")
          .get(body.categoryFilter)?.id || null;
    if (
      categoryId &&
      !this.db.prepare("SELECT id FROM categories WHERE id=?").get(categoryId)
    )
      fail("Categoria inexistente.");
    const config = this.campaigns.config({
      ...body,
      mode: "AUTO",
      startMode: "IMMEDIATE",
      timezone,
    });
    const row = {
      id: id(),
      recurrence,
      time_of_day: body.timeOfDay,
      timezone,
      start_date: startDate,
      specific_days: JSON.stringify(days),
    };
    const next = nextOccurrence(row, this.now() - 1000);
    if (!next) fail("Não há ocorrência futura para esta regra.");
    this.db
      .prepare(
        "INSERT INTO schedules(id,title,message,category_filter,category_id,recurrence,time_of_day,specific_days,pacing_seconds,timezone,start_date,next_run_at,config_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        row.id,
        text(body.title, "Título", 200),
        messageConfig.messageCategory === "SERVICE" &&
          active &&
          (messageConfig.type || "TEXT") === "TEXT"
          ? text(body.message, "Mensagem", 4096)
          : String(body.message || "").slice(0, 4096),
        body.categoryFilter || "TODOS",
        categoryId,
        recurrence,
        row.time_of_day,
        row.specific_days,
        config.pacingSeconds,
        timezone,
        startDate,
        next,
        JSON.stringify(config),
        utc(this.now()),
      );
    this.db
      .prepare(
        "UPDATE schedules SET active=?,message_category=?,message_config_json=? WHERE id=?",
      )
      .run(
        active,
        messageConfig.messageCategory,
        JSON.stringify(messageConfig),
        row.id,
      );
    if (scheduleId) {
      const saved = this.db
        .prepare("SELECT * FROM schedules WHERE id=?")
        .get(row.id);
      const fields = [
        "title",
        "message",
        "category_filter",
        "category_id",
        "recurrence",
        "time_of_day",
        "specific_days",
        "pacing_seconds",
        "timezone",
        "start_date",
        "next_run_at",
        "config_json",
        "active",
        "message_category",
        "message_config_json",
      ];
      this.db
        .prepare(
          "UPDATE schedules SET " +
            fields.map((f) => f + "=?").join(",") +
            ",review_required=0,reviewed_at=?,reason=NULL WHERE id=?",
        )
        .run(...fields.map((f) => saved[f]), utc(this.now()), scheduleId);
      this.db.prepare("DELETE FROM schedules WHERE id=?").run(row.id);
      return this.db
        .prepare("SELECT * FROM schedules WHERE id=?")
        .get(scheduleId);
    }
    return this.db.prepare("SELECT * FROM schedules WHERE id=?").get(row.id);
  }
  tick() {
    const now = utc(this.now());
    for (const s of this.db
      .prepare("SELECT * FROM schedules WHERE active=1")
      .all()) {
      if (s.review_required) {
        this.db.prepare("UPDATE schedules SET active=0 WHERE id=?").run(s.id);
        continue;
      }
      if (!s.next_run_at) {
        this.db
          .prepare(
            "UPDATE schedules SET start_date=COALESCE(start_date,?),next_run_at=? WHERE id=?",
          )
          .run(
            localDate(this.now(), s.timezone),
            nextOccurrence(s, this.now() - 1000),
            s.id,
          );
        continue;
      }
      if (s.next_run_at > now) continue;
      this.db.transaction(() => {
        const latest = this.db
          .prepare("SELECT * FROM schedules WHERE id=? AND active=1")
          .get(s.id);
        if (!latest || latest.next_run_at !== s.next_run_at) return;
        if (
          this.db
            .prepare(
              "SELECT 1 FROM schedule_occurrences WHERE schedule_id=? AND due_at=?",
            )
            .get(s.id, s.next_run_at)
        )
          return;
        const overlapping = this.db
          .prepare(
            "SELECT id FROM campaigns WHERE schedule_id=? AND execution_status NOT IN ('LEGACY','COMPLETED','COMPLETED_WITH_FAILURES','CANCELLED')",
          )
          .get(s.id);
        const status = overlapping ? "SKIPPED_OVERLAP" : "CREATED";
        let campaignId = null,
          finalStatus = status;
        if (!overlapping) {
          try {
            const config = JSON.parse(s.config_json || "{}");
            const selection = {
              type: "filters",
              filters: s.category_id
                ? { categoryId: s.category_id }
                : s.category_filter && s.category_filter !== "TODOS"
                  ? { category: s.category_filter }
                  : {},
            };
            const result = this.campaigns.create(
              {
                ...config,
                ...JSON.parse(s.message_config_json),
                title: s.title,
                message: s.message,
                selection,
                scheduleId: s.id,
                timezone: s.timezone,
                pacingSeconds: s.pacing_seconds,
                startMode: "IMMEDIATE",
                mode: "AUTO",
              },
              "schedule:" + s.id + ":" + s.next_run_at,
              "scheduler",
            );
            campaignId = result.campaign.id;
          } catch (e) {
            if (e.code === "NO_AUDIENCE") finalStatus = "SKIPPED_NO_AUDIENCE";
            else {
              this.db
                .prepare("UPDATE schedules SET active=0,reason=? WHERE id=?")
                .run(e.code + ": " + e.message, s.id);
              finalStatus = "SUSPENDED_" + (e.code || "VALIDATION");
            }
          }
        }
        this.db
          .prepare("INSERT INTO schedule_occurrences VALUES(?,?,?,?)")
          .run(s.id, s.next_run_at, campaignId, finalStatus);
        // At most one missed occurrence is recovered. Recompute from current wall time, never replay a backlog.
        const next =
          s.recurrence === "ONCE" ? null : nextOccurrence(s, this.now());
        this.db
          .prepare(
            "UPDATE schedules SET last_run_at=?,next_run_at=?,active=? WHERE id=?",
          )
          .run(
            now,
            next,
            next && !finalStatus.startsWith("SUSPENDED_") ? 1 : 0,
            s.id,
          );
      })();
    }
  }
}
module.exports = { Scheduler };
