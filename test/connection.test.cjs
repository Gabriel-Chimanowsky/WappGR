const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { BaileysManager } = require("../server/baileys");
const { fixture } = require("./helpers.cjs");
const { canSend } = require("../server/policy");
function sdk({
  version = async () => ({ version: [1, 2, 3] }),
  saveCreds = async () => {},
  sendMessage = async (jid, payload, options) => ({
    key: { id: options.messageId },
  }),
} = {}) {
  let sockets = 0;
  const ev = new EventEmitter();
  return {
    ev,
    get sockets() {
      return sockets;
    },
    module: {
      default: () => {
        sockets++;
        return { ev, logout: async () => {}, sendMessage };
      },
      useMultiFileAuthState: async () => ({ state: {}, saveCreds }),
      fetchLatestBaileysVersion: version,
      DisconnectReason: { loggedOut: 401 },
    },
  };
}
test("conexão: inicializações repetidas compartilham socket e logout cancela inicialização pendente", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-connect-")),
    auth = path.join(dir, "auth"),
    disabled = process.env.WAPPGR_DISABLE_WHATSAPP;
  delete process.env.WAPPGR_DISABLE_WHATSAPP;
  t.after(() => {
    if (disabled === undefined) delete process.env.WAPPGR_DISABLE_WHATSAPP;
    else process.env.WAPPGR_DISABLE_WHATSAPP = disabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let release, entered;
  const waiting = new Promise((r) => (entered = r)),
    mock = sdk({
      version: () => {
        entered();
        return new Promise((r) => (release = r));
      },
    }),
    manager = new BaileysManager({
      authDir: auth,
      loadSdk: async () => mock.module,
    });
  const first = manager.init(),
    second = manager.init();
  assert.equal(first, second);
  await waiting;
  await manager.logout();
  release({ version: [1, 2, 3] });
  await first;
  assert.equal(mock.sockets, 0);
  assert.equal(manager.getStatus().status, "DISCONNECTED");
  assert.equal(fs.existsSync(auth), false);
  const other = sdk(),
    connected = new BaileysManager({
      authDir: auth,
      loadSdk: async () => other.module,
    });
  await Promise.all([connected.init(), connected.init()]);
  await connected.init();
  assert.equal(other.sockets, 1);
  await connected.logout();
});
test("conexão: logout aguarda gravação de credenciais simuladas sem recriar autenticação depois", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-credentials-")),
    auth = path.join(dir, "auth"),
    disabled = process.env.WAPPGR_DISABLE_WHATSAPP;
  delete process.env.WAPPGR_DISABLE_WHATSAPP;
  t.after(() => {
    if (disabled === undefined) delete process.env.WAPPGR_DISABLE_WHATSAPP;
    else process.env.WAPPGR_DISABLE_WHATSAPP = disabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let finish, started;
  const pending = new Promise((r) => (started = r)),
    mock = sdk({
      saveCreds: async () => {
        started();
        await new Promise((r) => (finish = r));
        fs.writeFileSync(path.join(auth, "creds.json"), "synthetic");
      },
    }),
    manager = new BaileysManager({
      authDir: auth,
      loadSdk: async () => mock.module,
    });
  await manager.init();
  mock.ev.emit("creds.update");
  await pending;
  const loggingOut = manager.logout();
  finish();
  await loggingOut;
  assert.equal(fs.existsSync(auth), false);
  assert.equal(manager.getStatus().status, "DISCONNECTED");
});

test("Baileys integrado: campanha fora de 24h, entrada deduplicada, opt-out e restrição após reconexão", async (t) => {
  const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "wappgr-baileys-integrated-"),
    ),
    disabled = process.env.WAPPGR_DISABLE_WHATSAPP,
    f = fixture({ count: 3 }),
    calls = [],
    mock = sdk({
      sendMessage: async (jid, payload, options) => {
        calls.push({ jid, payload, options });
        return { key: { id: options.messageId } };
      },
    }),
    manager = new BaileysManager({
      authDir: path.join(dir, "synthetic-auth"),
      loadSdk: async () => mock.module,
    });
  delete process.env.WAPPGR_DISABLE_WHATSAPP;
  t.after(async () => {
    await manager.logout();
    f.db.close();
    if (disabled === undefined) delete process.env.WAPPGR_DISABLE_WHATSAPP;
    else process.env.WAPPGR_DISABLE_WHATSAPP = disabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  manager.setCallbacks({
    onMessage: (p) =>
      f.flows.receive({
        msgId: p.id,
        remoteJid: p.jid,
        phone: p.phone,
        pushName: p.name,
        text: p.text,
        clientTimestamp: p.clientTimestamp,
      }),
    onReceipt: (id, state) => f.dispatcher.receipt(id, state),
    onRestriction: (reason) => f.dispatcher.restrictAccount(reason),
  });
  f.dispatcher.provider = manager;
  f.db
    .prepare("UPDATE leads SET last_inbound_at=NULL WHERE id='lead000000'")
    .run();
  f.db
    .prepare("UPDATE leads SET last_inbound_at=? WHERE id='lead000001'")
    .run(new Date(f.now() - 90000000).toISOString());
  await Promise.all([manager.init(), manager.init()]);
  mock.ev.emit("connection.update", { connection: "open" });
  const campaign = f.create();
  await f.step(2);
  assert.equal(mock.sockets, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => Object.keys(c.payload).join() === "text"));
  assert.ok(calls.every((c) => /^[A-F0-9]{32}$/.test(c.options.messageId)));
  const old = f.db.prepare("SELECT * FROM leads WHERE id='lead000001'").get();
  assert.equal(canSend(old, "HUMAN_REPLY", f.now()), null); // opt-in, even outside 24h
  assert.ok(canSend({ ...old, status: "PENDING" }, "HUMAN_REPLY", f.now()));
  assert.ok(canSend(old, "REQUESTED_FLOW", f.now())); // preserved internal flow policy
  const out = f.db.prepare("SELECT * FROM leads WHERE id='lead000002'").get();
  const event = {
    type: "notify",
    messages: [
      {
        key: {
          id: "synthetic-optout",
          remoteJid: out.phone + "@s.whatsapp.net",
        },
        message: { conversation: "SAIR" },
        messageTimestamp: Math.floor(f.now() / 1000),
      },
    ],
  };
  mock.ev.emit("messages.upsert", event);
  mock.ev.emit("messages.upsert", event);
  await f.drain(campaign.id);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM inbound_events").get().n,
    1,
  );
  assert.equal(
    f.db.prepare("SELECT status FROM leads WHERE id=?").get(out.id).status,
    "OPT_OUT",
  );
  assert.equal(f.campaigns.get(campaign.id).sent, 2);
  assert.equal(f.campaigns.get(campaign.id).counts.SKIPPED, 1);
  assert.equal(
    calls.filter(
      (c) =>
        c.jid === out.phone + "@s.whatsapp.net" &&
        c.payload.text.startsWith("Olá"),
    ).length,
    0,
  );
  mock.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 403 } } },
  });
  assert.equal(f.dispatcher.accountStatus().restricted, 1);
  const restricted = f.create(),
    before = calls.length;
  await manager.init(); // reconnection itself cannot clear persistent account state
  mock.ev.emit("connection.update", { connection: "open" });
  f.advance(86400001);
  await f.step();
  assert.equal(f.dispatcher.accountStatus().restricted, 1);
  assert.equal(
    f.campaigns.get(restricted.id).execution_status,
    "ACCOUNT_RESTRICTED",
  );
  assert.equal(calls.length, before);
});

test("Baileys integrado: erro de rede conserva resultado incerto sem retry", async (t) => {
  const f = fixture({ count: 1 }),
    manager = new BaileysManager();
  t.after(() => f.db.close());
  let calls = 0;
  manager.state = "CONNECTED";
  manager.sock = {
    sendMessage: async () => {
      calls++;
      throw Error("socket interrompido");
    },
  };
  f.dispatcher.provider = manager;
  const c = f.create();
  await f.step();
  f.advance(3600000);
  await f.step(10);
  assert.equal(calls, 1);
  assert.equal(f.campaigns.get(c.id).counts.UNCERTAIN, 1);
  const r = f.campaigns.recipients(c.id).rows[0];
  assert.throws(() =>
    f.campaigns.control(
      c.id,
      "retry",
      { recipientIds: [r.id] },
      "uncertain-retry",
    ),
  );
});
test("Baileys: parada controlada fecha socket sem logout e preserva credenciais", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-stop-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "creds.json"), "synthetic-only");
  const manager = new BaileysManager({ authDir: dir });
  let ended = 0,
    loggedOut = 0;
  manager.state = "CONNECTED";
  manager.sock = { end: () => ended++, logout: () => loggedOut++ };
  await manager.stop();
  assert.equal(ended, 1);
  assert.equal(loggedOut, 0);
  assert.equal(manager.getStatus().status, "DISCONNECTED");
  assert.equal(manager.hasCredentials(), true);
  assert.equal(
    fs.readFileSync(path.join(dir, "creds.json"), "utf8"),
    "synthetic-only",
  );
  const disabled = process.env.WAPPGR_DISABLE_WHATSAPP;
  delete process.env.WAPPGR_DISABLE_WHATSAPP;
  try {
    let saved = 0;
    const mock = sdk({
      saveCreds: async () => {
        saved++;
        fs.writeFileSync(path.join(dir, "creds.json"), "synthetic-latest");
      },
    });
    const active = new BaileysManager({
      authDir: dir,
      loadSdk: async () => mock.module,
    });
    await active.init();
    mock.ev.emit("creds.update"); // stop before the queued promise starts
    await active.stop();
    mock.ev.emit("creds.update"); // old socket cannot enqueue another write
    await new Promise((r) => setImmediate(r));
    assert.equal(saved, 1);
    assert.equal(
      fs.readFileSync(path.join(dir, "creds.json"), "utf8"),
      "synthetic-latest",
    );
  } finally {
    if (disabled === undefined) delete process.env.WAPPGR_DISABLE_WHATSAPP;
    else process.env.WAPPGR_DISABLE_WHATSAPP = disabled;
  }
});
test("Baileys: falha transitória de inicialização reconecta sem operador e restrição impede reconexão automática", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-reconnect-")),
    disabled = process.env.WAPPGR_DISABLE_WHATSAPP;
  delete process.env.WAPPGR_DISABLE_WHATSAPP;
  fs.writeFileSync(path.join(dir, "creds.json"), "synthetic-only");
  let attempts = 0;
  const mock = sdk({
    version: async () => {
      if (++attempts === 1)
        throw Object.assign(Error("Rede sintética indisponível"), {
          code: "ECONNRESET",
        });
      return { version: [1, 2, 3] };
    },
  });
  const manager = new BaileysManager({
    authDir: dir,
    loadSdk: async () => mock.module,
    reconnectDelays: [20, 40],
  });
  t.after(async () => {
    await manager.stop();
    if (disabled === undefined) delete process.env.WAPPGR_DISABLE_WHATSAPP;
    else process.env.WAPPGR_DISABLE_WHATSAPP = disabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(manager.init(), /Rede sintética/);
  assert.ok(manager.getStatus().nextReconnectAt);
  const until = Date.now() + 2000;
  while (mock.sockets === 0 && Date.now() < until)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(mock.sockets, 1);
  assert.equal(attempts, 2);
  mock.ev.emit("connection.update", { connection: "open" });
  mock.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 403 } } },
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(mock.sockets, 1);
  assert.equal(manager.getStatus().nextReconnectAt, null);
});
