const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'wappgr.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  const d = getDb();

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
    const hasJid = tableInfo.some(col => col.name === 'jid');
    if (!hasJid) {
      d.exec("ALTER TABLE leads ADD COLUMN jid TEXT;");
    }
    d.exec("CREATE INDEX IF NOT EXISTS idx_leads_jid ON leads(jid);");
  } catch (e) {}

  // Seed connection row if empty
  const connRow = d.prepare('SELECT COUNT(*) as c FROM connection').get();
  if (connRow.c === 0) {
    d.prepare(`INSERT INTO connection (id, instance_name, status, instance_type, evolution_api_url)
               VALUES (1, 'wappgr-main', 'DISCONNECTED', 'EVOLUTION_API', 'http://localhost:8080')`).run();
  }

  // Seed default categories if empty
  const catCount = d.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    const insert = d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)');
    insert.run(uuidv4(), 'Clientes VIP', '#10b981', 'Compradores frequentes e de alto valor');
    insert.run(uuidv4(), 'Interessados', '#3b82f6', 'Leads que demonstraram interesse');
    insert.run(uuidv4(), 'Compradores Recentes', '#8b5cf6', 'Compraram nos últimos 30 dias');
    insert.run(uuidv4(), 'Leads Orgânicos', '#f59e0b', 'Entraram via WhatsApp diretamente');
  }

  // Seed default opt-in config
  const optInSetting = d.prepare("SELECT value FROM settings WHERE key = 'optInConfig'").get();
  if (!optInSetting) {
    const defaultConfig = {
      autoOptInOnFirstMessage: true,
      welcomeMessage: 'Olá! 👋 Seja bem-vindo! Para receber nossas ofertas exclusivas e novidades no WhatsApp, responda *SIM* ou *1*. Se não quiser receber, responda *SAIR*.',
      confirmationMessage: 'Perfeito! 🎉 Você agora receberá nossas novidades e promoções.',
      optOutMessage: 'Entendido! 👍 Você foi removido da lista e não receberá mais mensagens automáticas.',
      yesKeywords: ['SIM', 'QUERO', '1', 'ACEITO', 'SIM!'],
      noKeywords: ['SAIR', 'PARAR', 'CANCELAR', '2', 'NÃO', 'NAO']
    };
    d.prepare("INSERT INTO settings (key, value) VALUES ('optInConfig', ?)").run(JSON.stringify(defaultConfig));
  }

  // Seed sample interactive flow if empty
  const flowCount = d.prepare('SELECT COUNT(*) as c FROM flows').get();
  if (flowCount.c === 0) {
    const sampleSteps = [
      {
        id: 'step_1',
        title: 'Boas-vindas & Opções do Catálogo',
        type: 'TEXT',
        content: 'Olá {nome}! 🚀 Que bom falar com você. O que você gostaria de ver agora?',
        delaySeconds: 1,
        options: [
          { id: 'opt_1', label: 'Ver Catálogo Completo', keyword: '1', nextStepId: 'step_2' },
          { id: 'opt_2', label: 'Falar com Consultor Humano', keyword: '2', nextStepId: 'step_3' },
          { id: 'opt_3', label: 'Pegar Cupom de Desconto', keyword: '3', nextStepId: 'step_4' }
        ]
      },
      {
        id: 'step_2',
        title: 'Apresentação do Catálogo (Imagem/Vídeo)',
        type: 'IMAGE',
        mediaUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80',
        content: 'Aqui está o nosso catálogo de produtos mais vendidos deste mês com entrega rápida! ✨\n\nQual área você prefere?',
        delaySeconds: 2,
        changeCategory: 'Interessados',
        options: [
          { id: 'opt_2_1', label: 'Comprar com Desconto', keyword: '1', nextStepId: 'step_4' },
          { id: 'opt_2_2', label: 'Menu Principal', keyword: '2', nextStepId: 'step_1' }
        ]
      },
      {
        id: 'step_3',
        title: 'Transferência para Atendente Humano',
        type: 'TEXT',
        content: 'Perfeito! 👤 Transferi seu contato para nossa equipe. Um especialista entrará em contato com você aqui mesmo em poucos instantes.',
        delaySeconds: 1,
        changeCategory: 'Clientes VIP',
        options: []
      },
      {
        id: 'step_4',
        title: 'Envio de Cupom Exclusivo',
        type: 'TEXT',
        content: '🎁 Seu cupom exclusivo de 15% OFF é: *WAPP15*\n\nAproveite em nosso site ou fale com nosso time para resgatar!',
        delaySeconds: 1,
        changeCategory: 'Clientes VIP',
        options: [
          { id: 'opt_4_1', label: 'Voltar ao Menu', keyword: '1', nextStepId: 'step_1' }
        ]
      }
    ];

    d.prepare(`INSERT INTO flows (id, name, trigger_type, trigger_keywords, description, active, steps_json) 
               VALUES (?, ?, 'KEYWORD', 'QUERO, VER, CATALOGO, PRODUTOS, OFERTA, PLANOS', 'Funil de Apresentação e Qualificação de Vendas', 1, ?)`).run(
      uuidv4(), 'Funil Interativo de Vendas & Catálogo', JSON.stringify(sampleSteps)
    );
  }
}

// ─── HELPERS ───────────────────────────────────────────
function getSetting(key) {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(key, value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, json);
}

function generateId() {
  return uuidv4();
}

module.exports = { getDb, getSetting, setSetting, generateId, initTables };
