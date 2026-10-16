if (require.main === module) require("./config").loadEnvironment();
const path = require("node:path");
const fs = require("node:fs");
const Database = require("./sqlite");
const { acquireInstanceLock } = require("./instance-lock");
const { openDatabase } = require("./db");
const { id, utc } = require("./domain");
const { Campaigns } = require("./campaigns");
const filename = path.resolve(
  process.env.WAPPGR_DB_PATH || path.join(__dirname, "wappgr.db"),
);
function snapshot(filename) {
  const dir = path.join(path.dirname(filename), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destination = path.join(dir, "manual-" + Date.now() + ".sqlite");
  const db = new Database(filename);
  try {
    db.prepare("VACUUM INTO ?").run(destination);
  } finally {
    db.close();
  }
  return destination;
}
if (require.main === module) {
  let release;
  try {
    release = acquireInstanceLock(filename + ".instance-lock");
    if (process.argv[2] === "restore") {
      if (!process.argv[3]) throw Error("Informe o caminho do backup.");
      const source = path.resolve(process.argv[3]);
      if (source === filename) throw Error("Origem e destino iguais.");
      const check = new Database(source, { readonly: true });
      try {
        if (
          check.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
          !check
            .prepare("SELECT name FROM sqlite_master WHERE name='leads'")
            .get()
        )
          throw Error("Backup inválido.");
      } finally {
        check.close();
      }
      if (fs.existsSync(filename)) {
        console.log("Backup do estado anterior: " + snapshot(filename));
        const current = new Database(filename);
        current.pragma("wal_checkpoint(TRUNCATE)");
        current.close();
      }
      // All database handles and the single backend are closed under the instance lock.
      const staging = filename + ".restore-" + process.pid;
      fs.copyFileSync(source, staging);
      for (const suffix of ["-wal", "-shm"])
        fs.rmSync(filename + suffix, { force: true });
      fs.renameSync(staging, filename);
      const restored = openDatabase(filename);
      try {
        const at = utc(Date.now()),
          reason =
            "Banco restaurado: atividades posteriores ao backup precisam de reconciliação operacional";
        const campaigns = new Campaigns(restored);
        restored.transaction(() => {
          const affected = restored
            .prepare(
              "SELECT DISTINCT campaign_id id FROM campaign_recipients WHERE status IN ('PENDING','RESERVED','SENDING','RETRY_WAIT')",
            )
            .all();
          restored
            .prepare(
              "UPDATE campaign_recipients SET status='UNCERTAIN',error=?,updated_at=? WHERE status IN ('PENDING','RESERVED','SENDING','RETRY_WAIT')",
            )
            .run(reason, at);
          restored
            .prepare(
              "UPDATE outbound_jobs SET status='UNCERTAIN',error=?,updated_at=? WHERE status IN ('PENDING','SENDING')",
            )
            .run(reason, at);
          restored
            .prepare(
              "UPDATE send_attempts SET status='UNCERTAIN',error=?,finished_at=? WHERE status='STARTED'",
            )
            .run(reason, at);
          restored
            .prepare(
              "UPDATE messages SET status='UNCERTAIN',error=? WHERE status='SENDING'",
            )
            .run(reason);
          restored
            .prepare(
              "UPDATE account_control SET restricted=1,reason=?,not_before=NULL,updated_at=? WHERE id=1",
            )
            .run(reason, at);
          restored
            .prepare("INSERT INTO account_events VALUES(?,?,?,?,?)")
            .run(id(), "RESTORE", reason, "restore-cli", at);
          for (const c of affected) {
            restored
              .prepare("UPDATE campaigns SET manual_paused=1 WHERE id=?")
              .run(c.id);
            campaigns.setState(c.id, "ACCOUNT_RESTRICTED", reason);
            campaigns.event(c.id, "RESTORED", { reason }, "restore-cli");
          }
        })();
      } finally {
        restored.close();
      }
      console.log(
        "Banco restaurado e envios suspensos para revisão. Trabalhos pendentes do backup foram marcados como incertos e não serão reenviados automaticamente.",
      );
    } else console.log("Backup consistente: " + snapshot(filename));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    release?.();
  }
}
module.exports = { snapshot };
