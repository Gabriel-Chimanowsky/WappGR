const path = require("node:path");
const fs = require("node:fs");
const { loadEnvironment } = require("../server/config");
const config = loadEnvironment();
const { fixture } = require("./helpers.cjs");
const { createAdmin } = require("../server/auth");
const { startBackend } = require("../server/backend");
let clock = Date.parse("2026-10-16T09:00:00Z"),
  backend,
  held,
  calls = [];
const f = fixture({ filename: config.filename, count: 8, now: clock });
createAdmin(f.db, "autonomy-test", "senha-sintetica-autonomia");
f.db.close();
const provider = {
  callbacks: {},
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  },
  getStatus: () => ({ status: "CONNECTED" }),
  hasCredentials: () => false,
  async init() {},
  async stop() {},
  async send(target, payload, id, context) {
    const error = context.beforeSend?.();
    if (error) return { success: false, definitelyNotSent: true, error };
    calls.push({ target, text: payload.text, id });
    fs.appendFileSync(
      path.join(config.runtimeDir, "synthetic-calls.jsonl"),
      JSON.stringify(calls.at(-1)) + "\n",
    );
    if (process.env.TEST_HOLD_FIRST === "1" && calls.length === 1)
      await new Promise((resolve) => (held = resolve));
    return { success: true, messageId: id };
  },
};
(async () => {
  fs.mkdirSync(config.runtimeDir, { recursive: true });
  backend = await startBackend({
    config,
    provider,
    now: () => clock,
    intervalMs: 25,
    dispatchMs: 10,
    minSpacingMs: 100,
    onFatal: () => process.exit(70),
  });
  if (process.env.TEST_AUTORUN === "1")
    backend.campaigns.create(
      {
        title: "Autônoma sintética",
        message: "Envio autorizado no teste",
        batchSize: 40,
        pacingSeconds: 1,
      },
      "autorun-once",
    );
  const timer = setInterval(() => (clock += 1000), 40);
  const close = async () => {
    clearInterval(timer);
    await backend.shutdown("Teste de parada", 1000);
    process.exit(0);
  };
  process.on("disconnect", close);
  process.on("message", async (msg) => {
    if (msg.type === "shutdown") return close();
    try {
      let result;
      if (msg.cmd === "state")
        result = {
          calls,
          campaigns: backend.campaigns.list(),
          sessions: backend.db
            .prepare("SELECT * FROM lead_flow_sessions")
            .all(),
          schedules: backend.db.prepare("SELECT * FROM schedules").all(),
          jobs: backend.db.prepare("SELECT * FROM outbound_jobs").all(),
          health: backend.runtime.snapshot(),
        };
      if (msg.cmd === "expire") {
        backend.db
          .prepare("UPDATE admin_sessions SET expires_at=?")
          .run(new Date(clock - 1).toISOString());
        result = true;
      }
      if (msg.cmd === "resolve") {
        held?.();
        result = true;
      }
      if (msg.cmd === "advance") {
        clock += msg.ms;
        result = true;
      }
      if (msg.cmd === "defer-dispatch") {
        backend.db
          .prepare("UPDATE session_dispatch SET next_send_at=? WHERE id=1")
          .run(new Date(clock + 3600000).toISOString());
        result = true;
      }
      if (msg.cmd === "receive") {
        provider.callbacks.onMessage({
          id: msg.id || crypto.randomUUID(),
          jid: "5511900000007@s.whatsapp.net",
          phone: "+5511900000007",
          name: "Cliente sintético",
          text: msg.text,
          clientTimestamp: new Date(clock).toISOString(),
        });
        result = true;
      }
      if (msg.cmd === "close-http") {
        backend.server.closeAllConnections();
        result = true;
      }
      if (msg.cmd === "stop") return close();
      process.send({ reply: msg.requestId, result });
    } catch (error) {
      process.send({ reply: msg.requestId, error: error.message });
    }
  });
  process.send?.({
    type: "ready",
    root: "http://127.0.0.1:" + backend.server.address().port,
  });
})().catch((error) => {
  console.error(error.stack);
  process.exit(78);
});
