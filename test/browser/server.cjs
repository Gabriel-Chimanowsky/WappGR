const path = require("node:path");
const express = require("express");
const { fixture } = require("../helpers.cjs");
const { createApp } = require("../../server/app");
const { createAdmin } = require("../../server/auth");
const f = fixture({ count: 1000 });
createAdmin(f.db, "operador-teste", "senha-isolada-de-testes");
const app = createApp({ ...f, origins: ["http://127.0.0.1:3187"] });
app.post("/__test/reset", (req, res) => {
  f.setTime("2026-10-15T12:00:00Z");
  f.db.transaction(() => {
    for (const table of [
      "messages",
      "send_attempts",
      "campaign_events",
      "campaign_recipients",
      "campaign_batches",
      "schedule_occurrences",
      "campaigns",
      "schedules",
      "lead_flow_sessions",
      "flows",
      "outbound_jobs",
      "inbound_events",
      "consent_events",
      "idempotency_keys",
      "cloud_events",
      "cloud_message_links",
      "cloud_template_history",
      "cloud_rates",
      "configuration_history",
      "admin_sessions",
    ])
      f.db.prepare("DELETE FROM " + table).run();
    f.db.prepare("DELETE FROM leads WHERE id NOT LIKE 'lead%'").run();
    f.db
      .prepare(
        "UPDATE leads SET status='OPT_IN',last_inbound_at=?,cloud_last_inbound_at=?,messages_sent_count=0",
      )
      .run(new Date(f.now()).toISOString(), new Date(f.now()).toISOString());
    f.db
      .prepare(
        "UPDATE account_control SET restricted=0,reason=NULL,not_before=NULL",
      )
      .run();
    f.db.prepare("UPDATE session_dispatch SET next_send_at=NULL").run();
    f.db
      .prepare(
        "UPDATE cloud_templates SET status='APPROVED',present=1,synced_at=?",
      )
      .run(new Date(f.now()).toISOString());
  })();
  f.connect(true);
  res.json({ success: true });
});
app.post("/__test/legacy", (req, res) => {
  const c = f.create({ messageCategory: "SERVICE", template: null });
  f.db
    .prepare(
      "UPDATE campaigns SET message_category=NULL,message_config_json='{}',review_required=1,manual_paused=1,execution_status='REVIEW_REQUIRED' WHERE id=?",
    )
    .run(c.id);
  res.json({ id: c.id });
});
app.post("/__test/shutdown", (req, res) => {
  res.json({ success: true });
  setTimeout(() => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  }, 50);
});
app.post("/__test/step", async (req, res) => {
  await f.step(Number(req.body.n || 1));
  res.json(f.campaigns.list());
});
app.post("/__test/advance", (req, res) => {
  f.advance(Number(req.body.ms));
  res.json({ now: f.now() });
});
app.post("/__test/connect", (req, res) => {
  f.connect(!!req.body.value);
  res.json({ success: true });
});
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
const server = app.listen(3187, "127.0.0.1", () =>
  console.log("Fixture isolada pronta"),
);

process.on("SIGTERM", () => server.close(() => process.exit(0)));
