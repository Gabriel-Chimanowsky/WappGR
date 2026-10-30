const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("../server/sqlite");
const { openDatabase, initTables } = require("../server/db");
const { backupBeforeMigration } = require("../server/migrations");
test("Node SQLite: bindings, transactions, savepoints, rollback e foreign keys", () => {
  const db = openDatabase();
  db.exec(
    "CREATE TABLE test_parent(id TEXT PRIMARY KEY); CREATE TABLE test_child(id TEXT REFERENCES test_parent(id));",
  );
  db.prepare("INSERT INTO test_parent VALUES(?)").run("a");
  assert.throws(
    () => db.prepare("INSERT INTO test_child VALUES(?)").run("missing"),
    /FOREIGN KEY/,
  );
  assert.throws(() =>
    db.transaction(() => {
      db.prepare("INSERT INTO test_parent VALUES(?)").run("b");
      db.transaction(() => {
        db.prepare("INSERT INTO test_parent VALUES(?)").run("c");
      })();
      throw Error("rollback");
    })(),
  );
  assert.deepEqual(
    db
      .prepare("SELECT id FROM test_parent")
      .all()
      .map((r) => r.id),
    ["a"],
  );
  assert.throws(() => db.transaction(async () => {})(), /asynchronous/);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  db.close();
});
test("migração com WAL: backup consistente, legado preservado, restauração e reabertura", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-storage-")),
    file = path.join(dir, "old.db");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = new Database(file);
  old.pragma("journal_mode=WAL");
  old.pragma("wal_autocheckpoint=0");
  initTables(old);
  old
    .prepare(
      "INSERT INTO campaigns(id,title,message,status,sent_count,delivered_count) VALUES('legacy','Anterior','Teste','COMPLETED',12,12)",
    )
    .run();
  old
    .prepare(
      "INSERT INTO messages(id,direction,text,status,type) VALUES('old','OUTBOUND','Teste','SENT','BROADCAST_FAILED')",
    )
    .run();
  assert.ok(fs.existsSync(file + "-wal"));
  const backup = backupBeforeMigration(old, file);
  const snapshot = new Database(backup, { readonly: true });
  assert.equal(
    snapshot.prepare("SELECT sent_count FROM campaigns").get().sent_count,
    12,
  );
  assert.equal(snapshot.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  snapshot.close();
  old.close();
  let db = openDatabase(file);
  assert.equal(
    db.prepare("SELECT execution_status FROM campaigns").get().execution_status,
    "LEGACY",
  );
  assert.equal(
    db.prepare("SELECT status FROM messages").get().status,
    "LEGACY_UNKNOWN",
  );
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM campaign_recipients").get().n,
    0,
  );
  db.close();
  db = openDatabase(file);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
    3,
  );
  db.close();
  const restored = path.join(dir, "restored.db");
  fs.copyFileSync(backup, restored);
  db = openDatabase(restored);
  assert.equal(
    db.prepare("SELECT title FROM campaigns").get().title,
    "Anterior",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  db.close();
});

test("migração v1 para v2 preserva contagem antiga e reconcilia somente mensagens comprovadas", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-upgrade-")),
    filename = path.join(dir, "v1.db");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(filename);
  db.prepare(
    "INSERT INTO leads(id,name,phone,messages_sent_count) VALUES('lead','Sintético','5511999999999',37)",
  ).run();
  db.prepare(
    "INSERT INTO messages(id,lead_id,direction,text,status) VALUES('message','lead','OUTBOUND','Sintético','SENT')",
  ).run();
  db.exec(
    "ALTER TABLE leads DROP COLUMN legacy_messages_sent_count; DELETE FROM schema_migrations WHERE version=2;",
  );
  db.close();
  db = openDatabase(filename);
  const lead = db.prepare("SELECT * FROM leads").get();
  assert.equal(lead.legacy_messages_sent_count, 37);
  assert.equal(lead.messages_sent_count, 1);
  assert.equal(db.prepare("SELECT status FROM messages").get().status, "SENT");
  assert.equal(
    db.prepare("SELECT MAX(version) version FROM schema_migrations").get()
      .version,
    3,
  );
  db.close();
});

test("migração conserva comandos textuais de descadastro e remove apenas opções numéricas", () => {
  const db = new Database(":memory:");
  initTables(db);
  const config = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key='optInConfig'").get()
      .value,
  );
  config.noKeywords = ["NÃO", "NAO", "2", "DESCADASTRAR"];
  db.prepare("UPDATE settings SET value=? WHERE key='optInConfig'").run(
    JSON.stringify(config),
  );
  require("../server/migrations").migrate(db);
  const migrated = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key='optInConfig'").get()
      .value,
  );
  assert.ok(migrated.noKeywords.includes("NÃO"));
  assert.ok(migrated.noKeywords.includes("NAO"));
  assert.ok(!migrated.noKeywords.includes("2"));
  db.close();
});
