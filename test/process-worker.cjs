const fs = require("node:fs");
const { fixture } = require("./helpers.cjs");
const { acquireInstanceLock } = require("../server/instance-lock");
const release = acquireInstanceLock(process.env.TEST_DB + ".instance-lock");
let mode = "success",
  pending;
const f = fixture({
  filename: process.env.TEST_DB,
  now: Number(process.env.TEST_NOW),
  send: async (target, payload, messageId) => {
    if (mode === "hold")
      return new Promise((r) => {
        pending = r;
        process.send({ event: "inflight", messageId });
      });
    fs.appendFileSync(
      process.env.TEST_DB + ".provider-log",
      JSON.stringify({ messageId, target }) + "\n",
    );
    if (mode === "accepted-crash") {
      process.send({ event: "accepted", messageId });
      return new Promise(() => {});
    }
    return { success: true, messageId };
  },
});
f.dispatcher.recover();
const snapshot = () => ({
  campaigns: f.campaigns.list(),
  calls: f.calls.length,
  now: f.now(),
  account: f.dispatcher.accountStatus(),
});
process.on("message", async (msg) => {
  try {
    let result;
    if (msg.cmd === "create") result = f.create(msg.body, msg.key);
    if (msg.cmd === "control")
      result = f.campaigns.control(
        msg.campaignId,
        msg.action,
        msg.body || {},
        msg.key,
        "process-test",
      );
    if (msg.cmd === "step") {
      await f.step(msg.n || 1);
      result = snapshot();
    }
    if (msg.cmd === "state") result = snapshot();
    if (msg.cmd === "advance") {
      f.advance(msg.ms);
      result = snapshot();
    }
    if (msg.cmd === "mode") {
      mode = msg.mode;
      result = true;
    }
    if (msg.cmd === "resolve") {
      pending({ success: true });
      result = true;
    }
    if (msg.cmd === "connect") {
      f.connect(msg.value);
      result = true;
    }
    if (msg.cmd === "restrict") {
      f.dispatcher.restrictAccount(
        "Restrição sintética 24h",
        new Date(f.now() + 86400000).toISOString(),
        "test",
      );
      result = snapshot();
    }
    if (msg.cmd === "release") {
      f.dispatcher.releaseAccount("Revisão operacional sintética", "test");
      result = snapshot();
    }
    if (msg.cmd === "optout") {
      const lead = f.db
        .prepare("SELECT * FROM leads WHERE id=?")
        .get(msg.leadId);
      f.flows.receive({
        msgId: "out-" + msg.leadId,
        remoteJid: lead.phone + "@s.whatsapp.net",
        phone: "+" + lead.phone,
        text: "SAIR",
      });
      f.flows.tick();
      result = true;
    }
    if (msg.cmd === "receipt") {
      f.dispatcher.receipt(msg.providerId, msg.state);
      result = snapshot();
    }
    if (msg.cmd === "autonomous") {
      setImmediate(async () => {
        await f.step(msg.n);
        process.send({ event: "autonomous-finished", state: snapshot() });
      });
      result = true;
    }
    if (msg.cmd === "stop") {
      f.db.close();
      release();
      process.send({ reply: msg.requestId, result: true });
      process.exit(0);
      return;
    }
    process.send({ reply: msg.requestId, result });
  } catch (e) {
    process.send({ reply: msg.requestId, error: e.message });
  }
});
process.send({ event: "ready", state: snapshot() });
process.on("exit", release);
