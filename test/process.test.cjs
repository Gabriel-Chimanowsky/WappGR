const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const initial = Date.parse("2026-10-15T12:00:00Z");
function launch(filename, now = initial) {
  const child = fork(path.join(__dirname, "process-worker.cjs"), [], {
    env: {
      ...process.env,
      TEST_DB: filename,
      TEST_NOW: String(now),
      WAPPGR_DISABLE_WHATSAPP: "1",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const pending = new Map(),
    events = [],
    listeners = [];
  let seq = 0,
    stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.on("message", (msg) => {
    if (msg.reply) {
      const p = pending.get(msg.reply);
      if (p) {
        pending.delete(msg.reply);
        if (msg.error) p.reject(Error(msg.error));
        else p.resolve(msg.result);
      }
    } else {
      const i = listeners.findIndex((l) => l.name === msg.event);
      if (i >= 0) listeners.splice(i, 1)[0].resolve(msg);
      else events.push(msg);
    }
  });
  child.on("exit", () => {
    for (const p of pending.values()) p.reject(Error("Processo terminou"));
    for (const l of listeners) l.reject(Error(stderr || "Processo terminou"));
  });
  return {
    child,
    request(cmd, args = {}) {
      return new Promise((resolve, reject) => {
        const requestId = String(++seq);
        pending.set(requestId, { resolve, reject });
        child.send({ cmd, requestId, ...args });
      });
    },
    event(name) {
      const i = events.findIndex((e) => e.event === name);
      if (i >= 0) return Promise.resolve(events.splice(i, 1)[0]);
      return new Promise((resolve, reject) =>
        listeners.push({ name, resolve, reject }),
      );
    },
    async kill() {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    },
    async stop() {
      if (child.exitCode === null && !child.killed) await this.request("stop");
    },
  };
}
async function env(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-process-")),
    filename = path.join(dir, "isolated.db"),
    workers = [];
  t.after(async () => {
    for (const w of workers) await w.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    filename,
    async boot(now) {
      const w = launch(filename, now);
      workers.push(w);
      await w.event("ready");
      return w;
    },
  };
}
const command = (w, c, action, key = crypto.randomUUID()) =>
  w.request("control", { campaignId: c.id, action, key });
test(
  "processo real: pausa após 17, SIGKILL, recuperação pausada e saldo 23",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t);
    let w = await e.boot();
    const c = await w.request("create", { key: "create" });
    await w.request("step", { n: 17 });
    await command(w, c, "pause");
    const before = await w.request("state");
    await w.kill();
    w = await e.boot(before.now);
    assert.equal((await w.request("step", { n: 3 })).calls, 0);
    await command(w, c, "resume");
    const after = await w.request("step", { n: 23 });
    assert.equal(after.campaigns[0].sent, 40);
    assert.equal(after.campaigns[0].batch.number, 1);
    assert.equal(after.campaigns[0].batch.attempts, 40);
  },
);
test(
  "processo real: pausa com chamada em andamento, sem confirmação prematura",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t),
      w = await e.boot(),
      c = await w.request("create", { key: "create" });
    await w.request("mode", { mode: "hold" });
    const running = w.request("step");
    await w.event("inflight");
    assert.equal(
      (await command(w, c, "pause")).execution_status,
      "PAUSE_REQUESTED",
    );
    await w.request("resolve");
    await running;
    assert.equal(
      (await w.request("state")).campaigns[0].execution_status,
      "PAUSED",
    );
  },
);
test(
  "processo real: queda durante chamada deixa incerto sem reenvio",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t);
    let w = await e.boot();
    await w.request("create", { key: "create" });
    await w.request("mode", { mode: "hold" });
    const running = w.request("step").catch(() => {});
    await w.event("inflight");
    await w.kill();
    await running;
    w = await e.boot(initial + 10000);
    let state = await w.request("step");
    assert.equal(state.campaigns[0].counts.UNCERTAIN, 1);
    assert.equal(state.calls, 0); // recovery also preserves shared cadence
    state = await w.request("step");
    assert.equal(state.campaigns[0].sent, 1);
    assert.equal(state.calls, 1);
  },
);
test(
  "processo real: provedor aceitou, SIGKILL antes do commit, reconciliação por ID",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t);
    let w = await e.boot();
    await w.request("create", { key: "create" });
    await w.request("mode", { mode: "accepted-crash" });
    const running = w.request("step").catch(() => {});
    const receipt = await w.event("accepted");
    await w.kill();
    await running;
    w = await e.boot(initial + 10000);
    let state = await w.request("step");
    assert.equal(state.campaigns[0].counts.UNCERTAIN, 1);
    assert.equal(state.calls, 0);
    state = await w.request("step");
    const records = fs
      .readFileSync(e.filename + ".provider-log", "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(new Set(records.map((x) => x.target)).size, 2);
    state = await w.request("receipt", {
      providerId: receipt.messageId,
      state: "DELIVERED",
    });
    assert.equal(state.campaigns[0].counts.UNCERTAIN || 0, 0);
    assert.equal(state.campaigns[0].delivered, 1);
  },
);
test(
  "processo real: cadência reservada antes da rede e renovada ao recuperar envio interrompido",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t);
    let w = await e.boot();
    await w.request("create", {
      key: "cadence-crash",
      body: { pacingSeconds: 30 },
    });
    await w.request("mode", { mode: "hold" });
    const running = w.request("step").catch(() => {});
    await w.event("inflight");
    const { DatabaseSync } = require("node:sqlite");
    const persisted = new DatabaseSync(e.filename, { readOnly: true });
    try {
      assert.equal(
        persisted
          .prepare("SELECT next_send_at FROM session_dispatch WHERE id=1")
          .get().next_send_at,
        new Date(initial + 30000).toISOString(),
      );
    } finally {
      persisted.close();
    }
    await w.kill();
    await running;
    w = await e.boot(initial + 1000);
    let state = await w.request("step");
    assert.equal(state.calls, 0);
    assert.equal(state.campaigns[0].counts.UNCERTAIN, 1);
    await w.request("advance", { ms: 27999 });
    state = await w.request("step");
    assert.equal(state.calls, 0);
    state = await w.request("step");
    assert.equal(state.calls, 1);
    assert.equal(state.campaigns[0].sent, 1);
    assert.equal(state.campaigns[0].counts.UNCERTAIN, 1);
  },
);
test(
  "processo real: reiniciar intervalo preserva horário e não compensa lotes",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t);
    let w = await e.boot();
    await w.request("create", { key: "create" });
    const before = await w.request("step", { n: 40 }),
      next = before.campaigns[0].next_run_at;
    await w.kill();
    w = await e.boot(before.now + 10000);
    let state = await w.request("step");
    assert.equal(state.calls, 0);
    assert.equal(state.campaigns[0].next_run_at, next);
    await w.request("advance", { ms: 7200000 });
    state = await w.request("step");
    assert.equal(state.campaigns[0].current_batch, 2);
    assert.equal(state.calls, 1);
  },
);
test(
  "processo real: desconexão, comandos repetidos, opt-out e reconexão",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t),
      w = await e.boot();
    const c = await w.request("create", { key: "create" }),
      same = await w.request("create", { key: "create" });
    assert.equal(c.id, same.id);
    await w.request("connect", { value: false });
    assert.equal((await w.request("step", { n: 3 })).calls, 0);
    await command(w, c, "pause", "repeat");
    await command(w, c, "pause", "repeat");
    await w.request("optout", { leadId: "lead000000" });
    await w.request("connect", { value: true });
    assert.equal((await w.request("step")).campaigns[0].attempts, 0);
    await command(w, c, "resume");
    const result = await w.request("step", { n: 3 });
    assert.equal(result.campaigns[0].counts.SKIPPED, 1);
    await command(w, c, "cancel");
    const calls = (await w.request("state")).calls;
    assert.equal((await w.request("step", { n: 10 })).calls, calls);
  },
);
test(
  "processo real: worker continua sem navegador e segunda instância é recusada",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t),
      w = await e.boot();
    await w.request("create", { key: "create" });
    const second = launch(e.filename);
    await assert.rejects(second.event("ready"), /instância ativa/);
    await w.request("autonomous", { n: 40 });
    const state = (await w.event("autonomous-finished")).state;
    assert.equal(state.campaigns[0].sent, 40);
  },
);

test(
  "processo real: restrição permanece após SIGKILL, 24h e reconexão até revisão explícita",
  { timeout: 30000 },
  async (t) => {
    const e = await env(t);
    let w = await e.boot();
    const c = await w.request("create", { key: "create" });
    await w.request("step", { n: 3 });
    await w.request("restrict");
    const before = await w.request("state");
    await w.kill();
    w = await e.boot(before.now + 86400001);
    await w.request("connect", { value: false });
    await w.request("connect", { value: true });
    let state = await w.request("step", { n: 3 });
    assert.equal(state.calls, 0);
    assert.equal(state.account.restricted, 1);
    assert.equal(state.campaigns[0].execution_status, "ACCOUNT_RESTRICTED");
    await assert.rejects(command(w, c, "resume"), /restrição/);
    await w.request("release");
    state = await w.request("step");
    assert.equal(state.calls, 0);
    assert.equal(state.campaigns[0].execution_status, "PAUSED");
    await command(w, c, "resume");
    state = await w.request("step");
    assert.equal(state.calls, 1);
    assert.equal(state.campaigns[0].sent, 4);
  },
);
