const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { loadEnvironment } = require("./config");
const { acquireInstanceLock } = require("./instance-lock");
const { openDatabase } = require("./db");
const { Campaigns } = require("./campaigns");
const { Dispatcher } = require("./dispatcher");
const { Scheduler } = require("./scheduler");
const { Flows } = require("./flows");
const { createApp } = require("./app");
const { Runtime } = require("./runtime");
async function startBackend({
  config = loadEnvironment(),
  provider = require("./baileys"),
  now = Date.now,
  intervalMs = 1000,
  dispatchMs = 250,
  minSpacingMs = 2000,
  onFatal = () => {},
} = {}) {
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)
    throw Error("PORT inválida.");
  const dist = path.join(config.root, "dist");
  if (
    process.env.NODE_ENV === "production" &&
    !fs.existsSync(path.join(dist, "index.html"))
  )
    throw Error(
      "Build ausente. Execute npm run build antes de iniciar em produção.",
    );
  const releaseLock = acquireInstanceLock(config.filename + ".instance-lock");
  let db, runtime, server, shutdownPromise, releaseAuthLock;
  try {
    // The credential directory also has one owner, even if DB paths differ.
    releaseAuthLock = acquireInstanceLock(config.authDir + ".instance-lock");
    db = openDatabase(config.filename);
    const campaigns = new Campaigns(db, { now }),
      dispatcher = new Dispatcher(db, campaigns, provider, {
        now,
        minSpacingMs,
      });
    const scheduler = new Scheduler(db, campaigns, { now }),
      flows = new Flows(db, dispatcher, { now });
    dispatcher.beforeDispatch = (leadId) => flows.tick(leadId);
    provider.setCallbacks({
      onMessage: (p) =>
        flows.receive({
          msgId: p.id,
          remoteJid: p.jid,
          phone: p.phone,
          pushName: p.name,
          text: p.text,
          clientTimestamp: p.clientTimestamp,
        }),
      onReceipt: (id, status) => dispatcher.receipt(id, status),
      onRestriction: (reason) => dispatcher.restrictAccount(reason),
      onStatusChange: (state) =>
        db
          .prepare(
            "UPDATE connection SET status=?,phone=?,profile_name=?,updated_at=? WHERE id=1",
          )
          .run(
            state.status,
            state.phone,
            state.profileName,
            new Date().toISOString(),
          ),
    });
    dispatcher.recover();
    runtime = new Runtime({
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
    const app = createApp({
      db,
      campaigns,
      dispatcher,
      scheduler,
      flows,
      provider,
      now,
      origins: process.env.WAPPGR_ORIGINS?.split(",").map((x) => x.trim()),
      getHealth: () => runtime.snapshot(),
      isShuttingDown: () => runtime.closing,
    });
    if (fs.existsSync(dist)) {
      app.use(require("express").static(dist));
      app.get("/{*path}", (req, res) =>
        res.sendFile(path.join(dist, "index.html")),
      );
    }
    server = app.listen(config.port, config.host);
    await once(server, "listening");
    server.on("error", (error) => onFatal(error.message));
    runtime.start();
    console.log(
      "WappGR em http://" + config.host + ":" + server.address().port,
    );
    if (provider.hasCredentials())
      provider
        .init()
        .catch((error) =>
          runtime.log.write("error", "Falha de conexão: " + error.message),
        );
    const shutdown = (reason = "Parada administrativa", timeoutMs = 35000) => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        runtime.stop(reason);
        server.close();
        const until = Date.now() + timeoutMs;
        while (dispatcher.busy && Date.now() < until)
          await new Promise((resolve) => setTimeout(resolve, 50));
        const interrupted = dispatcher.busy;
        await provider.stop?.(); // closes the socket without logout or deleting credentials
        runtime.publish();
        if (!interrupted) {
          db.pragma("wal_checkpoint(PASSIVE)");
          db.close();
          releaseAuthLock();
          releaseLock();
        }
        // If still in flight the caller must exit; persisted SENDING becomes UNCERTAIN on recovery.
        return { interrupted };
      })();
      return shutdownPromise;
    };
    return {
      db,
      campaigns,
      dispatcher,
      scheduler,
      flows,
      provider,
      runtime,
      server,
      shutdown,
      releaseLock,
    };
  } catch (error) {
    runtime?.stop("Falha na inicialização");
    server?.close();
    db?.close();
    releaseAuthLock?.();
    releaseLock();
    throw error;
  }
}
module.exports = { startBackend };
