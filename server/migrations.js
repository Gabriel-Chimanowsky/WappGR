const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const VERSION = 2;
function needsMigration(db) {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
      .get()
  )
    return true;
  return (
    (db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v || 0) <
    VERSION
  );
}
function backupBeforeMigration(db, filename) {
  if (filename === ":memory:" || !needsMigration(db)) return null;
  const existing = db
    .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'")
    .get().n;
  if (!existing) return null;
  const dir = path.join(path.dirname(filename), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backup = path.join(
    dir,
    "before-v" + VERSION + "-" + Date.now() + "-" + randomUUID() + ".sqlite",
  );
  // VACUUM INTO takes a consistent SQLite snapshot, including committed WAL data.
  db.prepare("VACUUM INTO ?").run(backup);
  return backup;
}
function migrate(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  if (!needsMigration(db)) return;
  const add = (table, name, type) => {
    if (
      !db
        .prepare("PRAGMA table_info(" + table + ")")
        .all()
        .some((c) => c.name === name)
    )
      db.exec("ALTER TABLE " + table + " ADD COLUMN " + name + " " + type);
  };
  const current = db
    .prepare("SELECT COALESCE(MAX(version),0) version FROM schema_migrations")
    .get().version;
  if (current < 1)
    db.transaction(() => {
      for (const [name, type] of [
        ["execution_status", "TEXT NOT NULL DEFAULT 'LEGACY'"],
        ["reason", "TEXT"],
        ["config_json", "TEXT NOT NULL DEFAULT '{}'"],
        ["selection_json", "TEXT NOT NULL DEFAULT '{}'"],
        ["next_run_at", "TEXT"],
        ["current_batch", "INTEGER NOT NULL DEFAULT 0"],
        ["manual_paused", "INTEGER NOT NULL DEFAULT 0"],
        ["cancel_requested", "INTEGER NOT NULL DEFAULT 0"],
        ["awaiting_authorization", "INTEGER NOT NULL DEFAULT 0"],
        ["version", "INTEGER NOT NULL DEFAULT 0"],
        ["schedule_id", "TEXT"],
        ["updated_at", "TEXT"],
      ])
        add("campaigns", name, type);
      add("messages", "error", "TEXT");
      add("messages", "job_id", "TEXT");
      add("messages", "delivered_at", "TEXT");
      add("messages", "read_at", "TEXT");
      add("leads", "consent_reason", "TEXT");
      add("leads", "last_inbound_at", "TEXT");
      add("schedules", "timezone", "TEXT NOT NULL DEFAULT 'America/Sao_Paulo'");
      add("schedules", "start_date", "TEXT");
      add("schedules", "config_json", "TEXT NOT NULL DEFAULT '{}'");
      add("schedules", "category_id", "TEXT");
      add("lead_flow_sessions", "due_at", "TEXT");
      add("lead_flow_sessions", "expires_at", "TEXT");
      add(
        "lead_flow_sessions",
        "status",
        "TEXT NOT NULL DEFAULT 'WAITING_REPLY'",
      );
      add("lead_flow_sessions", "steps_executed", "INTEGER NOT NULL DEFAULT 0");
      add("lead_flow_sessions", "job_id", "TEXT");
      db.exec(`
      CREATE TABLE campaign_recipients (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), lead_id TEXT NOT NULL,
        position INTEGER NOT NULL, phone_snapshot TEXT NOT NULL, jid_snapshot TEXT, name_snapshot TEXT NOT NULL,
        category_snapshot TEXT, message_snapshot TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RESERVED','SENDING','SENT','DELIVERED','READ','RETRY_WAIT','FAILED','SKIPPED','CANCELLED','UNCERTAIN')),
        attempts INTEGER NOT NULL DEFAULT 0, retry_limit INTEGER NOT NULL DEFAULT 3, retryable INTEGER NOT NULL DEFAULT 0, error TEXT,
        next_attempt_at TEXT, provider_id TEXT, owner TEXT, claim_token TEXT, sent_at TEXT, updated_at TEXT NOT NULL,
        UNIQUE(campaign_id,lead_id), UNIQUE(campaign_id,phone_snapshot), UNIQUE(campaign_id,position)
      );
      CREATE TABLE campaign_batches (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), number INTEGER NOT NULL,
        attempt_limit INTEGER NOT NULL CHECK(attempt_limit>0), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=attempt_limit),
        status TEXT NOT NULL DEFAULT 'OPEN', started_at TEXT NOT NULL, finished_at TEXT, next_run_at TEXT,
        UNIQUE(campaign_id,number)
      );
      CREATE TABLE send_attempts (
        id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES campaign_recipients(id), batch_id TEXT NOT NULL REFERENCES campaign_batches(id),
        number INTEGER NOT NULL, status TEXT NOT NULL, provider_id TEXT NOT NULL UNIQUE, claim_token TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, error TEXT, UNIQUE(recipient_id,number)
      );
      CREATE TABLE campaign_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        kind TEXT NOT NULL, details TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE idempotency_keys (
        scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(scope,key)
      );
      CREATE TABLE outbound_jobs (
        id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
        phone_snapshot TEXT NOT NULL, jid_snapshot TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
        priority INTEGER NOT NULL, due_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        provider_id TEXT UNIQUE, error TEXT, source_id TEXT, source_version TEXT, actor TEXT
      );
      CREATE TABLE session_dispatch (id INTEGER PRIMARY KEY CHECK(id=1), next_send_at TEXT);
      INSERT INTO session_dispatch(id) VALUES(1);
      CREATE TABLE inbound_events (
        provider_id TEXT PRIMARY KEY, lead_id TEXT, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL, error TEXT
      );
      CREATE TABLE schedule_occurrences (
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE, due_at TEXT NOT NULL,
        campaign_id TEXT REFERENCES campaigns(id), status TEXT NOT NULL, PRIMARY KEY(schedule_id,due_at)
      );
      CREATE TABLE consent_events (
        id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, previous_status TEXT, status TEXT NOT NULL,
        source TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE admin_users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE account_control (id INTEGER PRIMARY KEY CHECK(id=1), restricted INTEGER NOT NULL DEFAULT 0, reason TEXT, not_before TEXT, updated_at TEXT);
      INSERT INTO account_control(id) VALUES(1);
      CREATE TABLE account_events(id TEXT PRIMARY KEY, action TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES admin_users(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE INDEX idx_recipients_work ON campaign_recipients(campaign_id,status,next_attempt_at,position);
      CREATE INDEX idx_attempts_provider ON send_attempts(provider_id);
      CREATE INDEX idx_jobs_due ON outbound_jobs(status,due_at,priority);
      CREATE INDEX idx_messages_provider ON messages(whatsapp_msg_id);
      CREATE UNIQUE INDEX idx_messages_job ON messages(job_id) WHERE job_id IS NOT NULL;
      CREATE INDEX idx_events_campaign ON campaign_events(campaign_id,id);
      CREATE INDEX idx_inbound_status ON inbound_events(status,created_at);
      CREATE TRIGGER delete_lead_sessions AFTER DELETE ON leads BEGIN
        DELETE FROM lead_flow_sessions WHERE lead_id=OLD.id;
        UPDATE outbound_jobs SET status='SKIPPED',error='Contato excluído' WHERE lead_id=OLD.id AND status='PENDING';
      END;
      UPDATE messages SET status='LEGACY_UNKNOWN' WHERE direction='OUTBOUND';
      UPDATE messages SET status='RECEIVED' WHERE direction='INBOUND';
      DELETE FROM lead_flow_sessions WHERE lead_id NOT IN (SELECT id FROM leads);
      UPDATE connection SET instance_type='BAILEYS_NATIVE',evolution_api_key='';
    `);
      const config = db
        .prepare("SELECT value FROM settings WHERE key='optInConfig'")
        .get();
      if (config) {
        const c = JSON.parse(config.value);
        c.yesKeywords = (c.yesKeywords || []).filter((k) => !/^\d+$/.test(k));
        c.noKeywords = [
          ...new Set([
            "SAIR",
            "PARAR",
            "CANCELAR",
            "DESCADASTRAR",
            ...(c.noKeywords || [])
              .filter(
                (k) =>
                  typeof k === "string" && k.trim() && !/^\d+$/.test(k.trim()),
              )
              .map((k) => k.trim().toUpperCase()),
          ]),
        ];
        db.prepare("UPDATE settings SET value=? WHERE key='optInConfig'").run(
          JSON.stringify(c),
        );
      }
      // Preserve existing demo definitions but never leave generated demos active by default.
      db.prepare(
        "UPDATE flows SET active=0 WHERE name='Funil Interativo de Vendas & Catálogo'",
      ).run();
      db.prepare(
        "UPDATE schedules SET category_id=(SELECT id FROM categories WHERE name=schedules.category_filter)",
      ).run();
      db.prepare("UPDATE schedules SET active=0 WHERE recurrence='ONCE'").run();
      for (const flow of db.prepare("SELECT id,steps_json FROM flows").all()) {
        try {
          const steps = JSON.parse(flow.steps_json).map((step) => ({
            ...step,
            changeCategoryId:
              step.changeCategoryId ||
              db
                .prepare("SELECT id FROM categories WHERE name=?")
                .get(step.changeCategory || "")?.id ||
              null,
          }));
          db.prepare("UPDATE flows SET steps_json=? WHERE id=?").run(
            JSON.stringify(steps),
            flow.id,
          );
        } catch {
          db.prepare("UPDATE flows SET active=0 WHERE id=?").run(flow.id);
        }
      }
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        1,
        new Date().toISOString(),
      );
    })();
  if (current < 2)
    db.transaction(() => {
      add("leads", "legacy_messages_sent_count", "INTEGER NOT NULL DEFAULT 0");
      db.exec(`UPDATE leads SET legacy_messages_sent_count=messages_sent_count,
      messages_sent_count=(SELECT COUNT(*) FROM messages m WHERE m.lead_id=leads.id AND m.direction='OUTBOUND' AND m.status IN ('SENT','DELIVERED','READ'));`);
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        2,
        new Date().toISOString(),
      );
    })();
}
module.exports = { migrate, backupBeforeMigration, VERSION };
