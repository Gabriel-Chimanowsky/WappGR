const { openDatabase } = require("../server/db");
const { Campaigns } = require("../server/campaigns");
const { Dispatcher } = require("../server/dispatcher");
const { Scheduler } = require("../server/scheduler");
const { Flows } = require("../server/flows");
function fixture({
  count = 50,
  filename = ":memory:",
  send,
  now = Date.parse("2026-10-15T12:00:00Z"),
} = {}) {
  let clock = now,
    connected = true;
  const db = openDatabase(filename),
    calls = [];
  const q = db.prepare(
    "INSERT OR IGNORE INTO leads(id,name,phone,status,created_at,last_inbound_at) VALUES(?,?,?,'OPT_IN',?,?)",
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++)
      q.run(
        "lead" + String(i).padStart(6, "0"),
        "Pessoa sintética " + i,
        "55119" + String(i).padStart(8, "0"),
        new Date(now).toISOString(),
        new Date(now).toISOString(),
      );
  })();
  const provider = {
    getStatus: () => ({ status: connected ? "CONNECTED" : "DISCONNECTED" }),
    send: async (...args) => {
      calls.push({ time: clock, args });
      return send ? send(...args) : { success: true, messageId: args[2] };
    },
  };
  const campaigns = new Campaigns(db, { now: () => clock }),
    dispatcher = new Dispatcher(db, campaigns, provider, {
      now: () => clock,
      minSpacingMs: 2000,
    });
  const scheduler = new Scheduler(db, campaigns, { now: () => clock }),
    flows = new Flows(db, dispatcher, { now: () => clock });
  dispatcher.beforeDispatch = (leadId) => flows.tick(leadId);
  const f = {
    db,
    campaigns,
    dispatcher,
    scheduler,
    flows,
    provider,
    calls,
    now: () => clock,
    advance: (ms) => (clock += ms),
    setTime: (v) => (clock = typeof v === "string" ? Date.parse(v) : v),
    connect: (v) => (connected = v),
    create: (body = {}, key = crypto.randomUUID()) =>
      campaigns.create(
        {
          title: "Teste isolado",
          message: "Olá {nome}",
          batchSize: 40,
          batchIntervalSeconds: 7200,
          pacingSeconds: 2,
          ...body,
        },
        key,
      ).campaign,
    async step(n = 1) {
      for (let i = 0; i < n; i++) {
        await dispatcher.tick();
        clock += 2000;
      }
    },
    async drain(campaignId, max = 5000) {
      for (let i = 0; i < max; i++) {
        await dispatcher.tick();
        const c = campaigns.get(campaignId);
        if (
          ["COMPLETED", "COMPLETED_WITH_FAILURES", "CANCELLED"].includes(
            c.execution_status,
          )
        )
          return c;
        clock += 2000;
        if (c.next_run_at && Date.parse(c.next_run_at) > clock)
          clock = Date.parse(c.next_run_at);
        const retry = db
          .prepare(
            "SELECT MIN(next_attempt_at) at FROM campaign_recipients WHERE status='RETRY_WAIT'",
          )
          .get().at;
        if (
          retry &&
          !db
            .prepare(
              "SELECT id FROM campaign_recipients WHERE status='PENDING'",
            )
            .get()
        )
          clock = Math.max(clock, Date.parse(retry));
      }
      throw Error("Fila não terminou");
    },
  };
  return f;
}
module.exports = { fixture };
