const Database = require("./sqlite");
const path = require("path");
const { randomUUID: uuidv4 } = require("node:crypto");
const { migrate, backupBeforeMigration } = require("./migrations");

const DB_PATH = process.env.WAPPGR_DB_PATH || path.join(__dirname, "wappgr.db");

let db;

function getDb() {
  if (!db) db = openDatabase(DB_PATH);
  return db;
}

function openDatabase(filename = ":memory:") {
  const database = new Database(filename);
  database.pragma("busy_timeout = 5000");
  const backup = backupBeforeMigration(database, filename);
  if (backup) console.log("Backup consistente criado: " + backup);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  initTables(database);
  migrate(database);
  return database;
}

function initTables(database) {
  const d = database;

  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#10b981',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      jid TEXT,
      name TEXT NOT NULL,
      category_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('OPT_IN','OPT_OUT','PENDING')),
      consent_method TEXT DEFAULT 'NONE',
      consent_timestamp TEXT,
      notes TEXT DEFAULT '',
      messages_sent_count INTEGER DEFAULT 0,
      last_interaction TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category_filter TEXT DEFAULT 'TODOS',
      total_target INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      delivered_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      pacing_seconds INTEGER DEFAULT 10,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','COMPLETED','FAILED')),
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category_filter TEXT DEFAULT 'TODOS',
      recurrence TEXT NOT NULL DEFAULT 'DAILY' CHECK(recurrence IN ('DAILY','EVERY_OTHER_DAY','SPECIFIC_DAYS','ONCE')),
      time_of_day TEXT NOT NULL,
      specific_days TEXT DEFAULT '[]',
      pacing_seconds INTEGER DEFAULT 10,
      active INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      lead_phone TEXT,
      lead_name TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),
      text TEXT NOT NULL,
      type TEXT DEFAULT 'CHAT',
      whatsapp_msg_id TEXT,
      status TEXT DEFAULT 'SENT',
      campaign_id TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS connection (
      id INTEGER PRIMARY KEY DEFAULT 1,
      instance_name TEXT DEFAULT 'wappgr-main',
      status TEXT DEFAULT 'DISCONNECTED',
      phone TEXT,
      profile_name TEXT,
      instance_type TEXT DEFAULT 'EVOLUTION_API',
      evolution_api_url TEXT DEFAULT 'http://localhost:8080',
      evolution_api_key TEXT DEFAULT '',
      connected_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_type TEXT DEFAULT 'KEYWORD',
      trigger_keywords TEXT DEFAULT '',
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lead_flow_sessions (
      lead_id TEXT PRIMARY KEY,
      lead_phone TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      current_step_id TEXT NOT NULL,
      last_message_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
    CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category_id);
    CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_flows_active ON flows(active);
  `);

  // Migration: add jid column if missing
  try {
    const tableInfo = d.prepare("PRAGMA table_info(leads)").all();
    const hasJid = tableInfo.some((col) => col.name === "jid");
    if (!hasJid) {
      d.exec("ALTER TABLE leads ADD COLUMN jid TEXT;");
    }
    d.exec("CREATE INDEX IF NOT EXISTS idx_leads_jid ON leads(jid);");
  } catch (e) {
    throw new Error("Falha na migração do JID: " + e.message);
  }

  // Seed connection row if empty
  const connRow = d.prepare("SELECT COUNT(*) as c FROM connection").get();
  if (connRow.c === 0) {
    d.prepare(
      `INSERT INTO connection (id, instance_name, status, instance_type, evolution_api_url)
               VALUES (1, 'wappgr-main', 'DISCONNECTED', 'EVOLUTION_API', 'http://localhost:8080')`,
    ).run();
  }

  // Seed default categories if empty
  const catCount = d.prepare("SELECT COUNT(*) as c FROM categories").get();
  if (catCount.c === 0) {
    const insert = d.prepare(
      "INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)",
    );
    insert.run(
      uuidv4(),
      "Clientes VIP",
      "#10b981",
      "Compradores frequentes e de alto valor",
    );
    insert.run(
      uuidv4(),
      "Interessados",
      "#3b82f6",
      "Leads que demonstraram interesse",
    );
    insert.run(
      uuidv4(),
      "Compradores Recentes",
      "#8b5cf6",
      "Compraram nos últimos 30 dias",
    );
    insert.run(
      uuidv4(),
      "Leads Orgânicos",
      "#f59e0b",
      "Entraram via WhatsApp diretamente",
    );
  }

  // Seed default opt-in config
  const optInSetting = d
    .prepare("SELECT value FROM settings WHERE key = 'optInConfig'")
    .get();
  if (!optInSetting) {
    const defaultConfig = {
      autoOptInOnFirstMessage: true,
      welcomeMessage:
        "Olá! 👋 Seja bem-vindo! Para receber nossas ofertas exclusivas e novidades no WhatsApp, responda *SIM*. Se não quiser receber, responda *SAIR*.",
      confirmationMessage:
        "Perfeito! 🎉 Você agora receberá nossas novidades e promoções.",
      optOutMessage:
        "Entendido! 👍 Você foi removido da lista e não receberá mais mensagens automáticas.",
      yesKeywords: ["SIM", "ACEITO", "AUTORIZO"],
      noKeywords: ["SAIR", "PARAR", "CANCELAR", "DESCADASTRAR"],
    };
    d.prepare(
      "INSERT INTO settings (key, value) VALUES ('optInConfig', ?)",
    ).run(JSON.stringify(defaultConfig));
  }
}

function getSetting(key) {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}
function setSetting(key, value) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)",
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}
function generateId() {
  return uuidv4();
}
module.exports = {
  getDb,
  getSetting,
  setSetting,
  generateId,
  initTables,
  openDatabase,
};
