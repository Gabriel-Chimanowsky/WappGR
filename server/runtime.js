const { writeJson, RotatingLog } = require("./operations");
const path = require("node:path");
class Runtime {
  constructor({
    db,
    dispatcher,
    scheduler,
    flows,
    provider,
    config,
    now = Date.now,
    intervalMs = 1000,
    dispatchMs = 250,
    onFatal = () => {},
  }) {
    Object.assign(this, {
      db,
      dispatcher,
      scheduler,
      flows,
      provider,
      config,
      now,
      intervalMs,
      dispatchMs,
      onFatal,
    });
    this.startedAt = new Date().toISOString();
    this.closing = false;
    this.loops = {};
    this.log = new RotatingLog(path.join(config.logsDir, "runtime.log"));
    this.timers = [];
  }
  async run(name, fn) {
    const loop = (this.loops[name] ||= { busy: false, errors: 0 });
    if (loop.busy || this.closing) return;
    loop.busy = true;
    loop.startedAt = new Date().toISOString();
    try {
      await fn();
      loop.completedAt = new Date().toISOString();
      loop.errors = 0;
      loop.error = null;
    } catch (error) {
      loop.error = error.message;
      loop.errors++;
      this.log.write("error", name + ": " + error.message);
      if (loop.errors >= 5) this.onFatal("Falhas consecutivas em " + name);
    } finally {
      loop.busy = false;
    }
  }
  snapshot() {
    const count = (table, condition) =>
      this.db
        .prepare("SELECT COUNT(*) n FROM " + table + " WHERE " + condition)
        .get().n;
    const account = this.dispatcher.accountStatus();
    const providerStatus = this.provider.getStatus();
    const connection = providerStatus.status;
    const reasons = [];
    if (account.restricted)
      reasons.push({
        type: "ACCOUNT_RESTRICTED",
        reason: account.reason,
        notBefore: account.not_before,
      });
    if (connection !== "CONNECTED")
      reasons.push({
        type: "DISCONNECTED",
        reason:
          providerStatus.lastDisconnectReason ||
          "WhatsApp desconectado; nenhuma nova chamada iniciada",
      });
    const paused = count(
      "campaigns",
      "manual_paused=1 AND execution_status NOT IN ('CANCELLED','COMPLETED','COMPLETED_WITH_FAILURES','LEGACY')",
    );
    if (paused) reasons.push({ type: "MANUAL_PAUSE", count: paused });
    return {
      pid: process.pid,
      transport: "CLOUD_API",
      startedAt: this.startedAt,
      heartbeatAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      state: this.closing
        ? "STOPPING"
        : Object.values(this.loops).some((l) => l.errors)
          ? "DEGRADED"
          : "RUNNING",
      connection,
      lastConnectionAt: providerStatus.lastConnectionAt || null,
      nextReconnectAt: providerStatus.nextReconnectAt || null,
      account: {
        restricted: !!account.restricted,
        reason: account.restricted ? account.reason : null,
        notBefore: account.not_before,
      },
      dispatcher: {
        busy: this.dispatcher.busy,
        ...this.loops.dispatcher,
        nextSendAt: this.db
          .prepare("SELECT next_send_at FROM session_dispatch WHERE id=1")
          .get().next_send_at,
      },
      loops: this.loops,
      suspensionReasons: reasons,
      activity: {
        lastMessageAt: this.db
          .prepare("SELECT MAX(timestamp) at FROM messages")
          .get().at,
        lastAttemptAt: this.db
          .prepare("SELECT MAX(started_at) at FROM send_attempts")
          .get().at,
        pendingInbox: count("inbound_events", "status='PENDING'"),
        pendingJobs: count("outbound_jobs", "status='PENDING'"),
        activeSchedules: count("schedules", "active=1"),
        activeFlows: count("flows", "active=1"),
      },
    };
  }
  publish() {
    const health = this.snapshot();
    writeJson(this.config.healthFile, health);
    return health;
  }
  start() {
    // These timers belong to the backend process; no HTTP request or session owns them.
    this.timers.push(
      setInterval(
        () => this.run("dispatcher", () => this.dispatcher.tick()),
        this.dispatchMs,
      ),
    );
    this.timers.push(
      setInterval(
        () =>
          this.run("automations", () => {
            this.provider.processEvents?.(this.dispatcher, this.flows);
            this.flows.tick();
            this.scheduler.tick();
          }),
        this.intervalMs,
      ),
    );
    this.timers.push(
      setInterval(
        () => this.run("catalog", () => this.provider.refreshIfDue?.()),
        1000,
      ),
    );
    this.timers.push(
      setInterval(() => this.run("health", () => this.publish()), 1000),
    );
    this.publish();
    this.log.write(
      "info",
      "Backend iniciado; automações independentes de navegador e sessão administrativa.",
    );
  }
  stop(reason) {
    this.closing = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.dispatcher.stop();
    this.log.write("info", "Parada controlada: " + reason);
    this.publish();
  }
}
module.exports = { Runtime };
