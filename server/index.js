const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { getDb, getSetting, setSetting, generateId } = require('./db');
const baileys = require('./baileys');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── HELPER: Log message to DB ────────────────────────
function logMessage(leadId, leadPhone, leadName, text, direction, type, whatsappMsgId, campaignId) {
  const d = getDb();
  const id = generateId();
  d.prepare(`INSERT INTO messages (id, lead_id, lead_phone, lead_name, direction, text, type, whatsapp_msg_id, campaign_id, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
    id, leadId, leadPhone, leadName, direction, text, type, whatsappMsgId || null, campaignId || null
  );
  return id;
}

// ─── HELPER: Send message via Baileys (Native Real WhatsApp) ────
async function sendWhatsAppMessage(phone, text) {
  return await baileys.sendText(phone, text);
}

// ─── FLOW ENGINE: Execute Step ───────────────────────────
async function executeFlowStep(lead, flow, step) {
  const d = getDb();
  if (!lead || !step) return;

  // 1. Personalize text
  const rawText = step.content || step.caption || '';
  const personalizedText = rawText
    .replace(/{nome}/g, lead.name)
    .replace(/{categoria}/g, lead.category_name || lead.category || '')
    .replace(/{telefone}/g, lead.phone);

  // 2. Change category if configured in step
  if (step.changeCategory) {
    let cat = d.prepare('SELECT id FROM categories WHERE name = ?').get(step.changeCategory);
    if (!cat) {
      const catId = generateId();
      d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)').run(catId, step.changeCategory, '#10b981', 'Criada via fluxo');
      d.prepare('UPDATE leads SET category_id = ? WHERE id = ?').run(catId, lead.id);
    } else {
      d.prepare('UPDATE leads SET category_id = ? WHERE id = ?').run(cat.id, lead.id);
    }
    console.log(`[Flow] Lead ${lead.name} movido para categoria "${step.changeCategory}"`);
  }

  // 3. Human delay if configured
  if (step.delaySeconds && Number(step.delaySeconds) > 0) {
    await new Promise(resolve => setTimeout(resolve, Number(step.delaySeconds) * 1000));
  }

  // 4. Send media/text via Baileys
  const target = lead.jid || lead.phone;
  const result = await baileys.sendMedia(target, {
    type: step.type || 'TEXT',
    mediaUrl: step.mediaUrl,
    text: personalizedText,
    caption: personalizedText,
    options: step.options || []
  });

  if (result?.jid && (!lead.jid || lead.jid !== result.jid)) {
    d.prepare('UPDATE leads SET jid = ? WHERE id = ?').run(result.jid, lead.id);
    lead.jid = result.jid;
  }

  logMessage(lead.id, lead.phone, lead.name, personalizedText, 'OUTBOUND', 'FLOW_STEP', result?.messageId);
  d.prepare("UPDATE leads SET messages_sent_count = messages_sent_count + 1, last_interaction = datetime('now') WHERE id = ?").run(lead.id);

  // 5. Update session state
  if (step.options && step.options.length > 0) {
    d.prepare(`INSERT OR REPLACE INTO lead_flow_sessions (lead_id, lead_phone, flow_id, current_step_id, last_message_at) 
               VALUES (?, ?, ?, ?, datetime('now'))`).run(
      lead.id, lead.phone, flow.id, step.id
    );
  } else if (step.nextStepId) {
    let steps = [];
    try { steps = JSON.parse(flow.steps_json); } catch {}
    const nextStep = steps.find(s => s.id === step.nextStepId);
    if (nextStep) {
      setTimeout(() => {
        executeFlowStep(lead, flow, nextStep);
      }, (step.delaySeconds || 2) * 1000);
    } else {
      d.prepare('DELETE FROM lead_flow_sessions WHERE lead_id = ?').run(lead.id);
    }
  } else {
    d.prepare('DELETE FROM lead_flow_sessions WHERE lead_id = ?').run(lead.id);
    console.log(`[Flow] Fluxo "${flow.name}" concluído para ${lead.name}`);
  }
}

// ─── BAILEYS CALLBACKS CONFIGURATION ─────────────────
baileys.setCallbacks({
  onStatusChange: ({ status, phone, profileName }) => {
    const d = getDb();
    if (status === 'CONNECTED') {
      d.prepare("UPDATE connection SET status = 'CONNECTED', phone = ?, profile_name = ?, connected_at = datetime('now'), updated_at = datetime('now') WHERE id = 1")
        .run(phone || '', profileName || 'WhatsApp Conectado');
    } else if (status === 'PAIRING') {
      d.prepare("UPDATE connection SET status = 'PAIRING', updated_at = datetime('now') WHERE id = 1").run();
    } else if (status === 'DISCONNECTED') {
      d.prepare("UPDATE connection SET status = 'DISCONNECTED', phone = NULL, profile_name = NULL, updated_at = datetime('now') WHERE id = 1").run();
    }
  },

  onMessage: async ({ phone, remoteJid, text, pushName, msgId }) => {
    const d = getDb();
    const config = getSetting('optInConfig') || {};
    const cleanedPhone = phone.replace(/\D/g, '');

    // 1. Find or create lead by jid OR phone
    let lead = d.prepare('SELECT * FROM leads WHERE jid = ? OR phone = ?').get(remoteJid, cleanedPhone);

    if (!lead) {
      const defaultCat = d.prepare("SELECT id FROM categories WHERE name = 'Leads Orgânicos'").get();
      const id = generateId();
      d.prepare(`INSERT INTO leads (id, phone, jid, name, category_id, status, consent_method, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', 'NONE', datetime('now'))`)
        .run(id, cleanedPhone, remoteJid, pushName || `Contato ${cleanedPhone.slice(-4)}`, defaultCat?.id || null);
      lead = d.prepare('SELECT * FROM leads WHERE id = ?').get(id);
      console.log(`[WappGR] Novo lead capturado: ${lead.name} (${cleanedPhone}, JID: ${remoteJid})`);
    } else if (!lead.jid || lead.jid !== remoteJid) {
      d.prepare('UPDATE leads SET jid = ? WHERE id = ?').run(remoteJid, lead.id);
      lead.jid = remoteJid;
    }

    // 2. Log inbound message
    logMessage(lead.id, cleanedPhone, lead.name, text, 'INBOUND', 'CHAT', msgId);
    d.prepare("UPDATE leads SET last_interaction = datetime('now') WHERE id = ?").run(lead.id);

    // 3. Flow Engine: Check active session
    const session = d.prepare('SELECT * FROM lead_flow_sessions WHERE lead_id = ? OR lead_phone = ?').get(lead.id, cleanedPhone);
    if (session) {
      const flow = d.prepare('SELECT * FROM flows WHERE id = ? AND active = 1').get(session.flow_id);
      if (flow) {
        let steps = [];
        try { steps = JSON.parse(flow.steps_json); } catch {}
        const currentStep = steps.find(s => s.id === session.current_step_id);

        if (currentStep && currentStep.options && currentStep.options.length > 0) {
          const textClean = text.trim().toLowerCase();
          const matchedOpt = currentStep.options.find((opt, idx) => {
            const key = (opt.keyword || String(idx + 1)).toLowerCase();
            const label = (opt.label || '').toLowerCase();
            return textClean === key || textClean === label || (textClean.length >= 3 && label.includes(textClean));
          });

          if (matchedOpt && matchedOpt.nextStepId) {
            const nextStep = steps.find(s => s.id === matchedOpt.nextStepId);
            if (nextStep) {
              console.log(`[Flow] ${lead.name} selecionou "${matchedOpt.label}" -> Próximo passo: "${nextStep.title || nextStep.id}"`);
              await executeFlowStep(lead, flow, nextStep);
              return; // Flow handled!
            }
          }
        }
      }
    }

    // 4. Flow Engine: Check triggers for new flow initiation
    const activeFlows = d.prepare("SELECT * FROM flows WHERE active = 1").all();
    for (const fl of activeFlows) {
      let shouldTrigger = false;
      const kwList = (fl.trigger_keywords || '').split(',').map(k => k.trim().toUpperCase()).filter(Boolean);
      const textUpper = text.trim().toUpperCase();

      if (fl.trigger_type === 'ALL_NEW' && lead.messages_sent_count <= 1) {
        shouldTrigger = true;
      } else if (kwList.some(k => textUpper.includes(k) || textUpper === k)) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        let steps = [];
        try { steps = JSON.parse(fl.steps_json); } catch {}
        if (steps.length > 0) {
          console.log(`[Flow] Disparando fluxo "${fl.name}" para ${lead.name} via gatilho "${text}"`);
          await executeFlowStep(lead, fl, steps[0]);
          return; // Flow handled!
        }
      }
    }

    // 5. Process Opt-in / Opt-out Keywords (se não foi capturado por fluxo)
    const textUpper = text.trim().toUpperCase();
    const yesKW = (config.yesKeywords || ['SIM', '1', 'QUERO', 'ACEITO']).map(k => k.toUpperCase());
    const noKW = (config.noKeywords || ['SAIR', '2', 'PARAR', 'CANCELAR']).map(k => k.toUpperCase());

    let replyText = null;

    if (yesKW.includes(textUpper)) {
      d.prepare("UPDATE leads SET status = 'OPT_IN', consent_method = 'WHATSAPP_KEYWORD', consent_timestamp = datetime('now'), last_interaction = datetime('now') WHERE id = ?").run(lead.id);
      replyText = config.confirmationMessage || 'Perfeito! 🎉 Seu cadastro foi ativado. Você receberá nossas novidades.';
      console.log(`[WappGR] Lead ${lead.name} ATIVOU OPT-IN via keyword "${text}"`);
    } else if (noKW.includes(textUpper)) {
      d.prepare("UPDATE leads SET status = 'OPT_OUT', consent_method = 'OPT_OUT_REQUESTED', consent_timestamp = datetime('now'), last_interaction = datetime('now') WHERE id = ?").run(lead.id);
      replyText = config.optOutMessage || 'Entendido! 👍 Você foi removido da lista e não receberá mais mensagens.';
      console.log(`[WappGR] Lead ${lead.name} ATIVOU OPT-OUT via keyword "${text}"`);
    } else if (lead.status === 'PENDING' && config.autoOptInOnFirstMessage) {
      replyText = config.welcomeMessage;
      console.log(`[WappGR] Mensagem de boas-vindas enviada para ${lead.name}`);
    }

    // 6. Send Automated Reply if applicable
    if (replyText) {
      const target = lead.jid || remoteJid || cleanedPhone;
      const result = await sendWhatsAppMessage(target, replyText);
      logMessage(lead.id, cleanedPhone, lead.name, replyText, 'OUTBOUND', 'AUTO_REPLY', result?.messageId);
    }
  }
});

// Auto-start Baileys if auth exists
baileys.init();

// ════════════════════════════════════════════════════════
// 1. DASHBOARD STATS
// ════════════════════════════════════════════════════════
app.get('/api/v1/dashboard/stats', (req, res) => {
  const d = getDb();
  const baileysStatus = baileys.getStatus();

  const totalLeads = d.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  const optedInCount = d.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'OPT_IN'").get().c;
  const optedOutCount = d.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'OPT_OUT'").get().c;
  const pendingCount = d.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'PENDING'").get().c;
  const totalBroadcastSent = d.prepare("SELECT COALESCE(SUM(sent_count), 0) as c FROM campaigns").get().c;
  const activeSchedulesCount = d.prepare("SELECT COUNT(*) as c FROM schedules WHERE active = 1").get().c;
  const campaignsCount = d.prepare('SELECT COUNT(*) as c FROM campaigns').get().c;
  const conn = d.prepare('SELECT * FROM connection WHERE id = 1').get() || {};

  const optInRatePercent = totalLeads > 0 ? Math.round((optedInCount / totalLeads) * 100) : 0;

  // Real data for charts: messages per day (last 7 days)
  const dailyStats = d.prepare(`
    SELECT DATE(timestamp) as day,
           COUNT(*) FILTER (WHERE direction = 'OUTBOUND') as sent,
           COUNT(*) FILTER (WHERE direction = 'INBOUND') as received
    FROM messages
    WHERE timestamp >= datetime('now', '-7 days')
    GROUP BY DATE(timestamp)
    ORDER BY day ASC
  `).all();

  // Recent messages
  const recentMessages = d.prepare(`
    SELECT * FROM messages ORDER BY timestamp DESC LIMIT 15
  `).all();

  res.json({
    totalLeads,
    optedInCount,
    optedOutCount,
    pendingCount,
    optInRatePercent,
    totalBroadcastSent,
    activeSchedulesCount,
    campaignsCount,
    connectionStatus: baileysStatus.status || conn.status,
    connectedPhone: baileysStatus.phone || conn.phone,
    instanceType: 'BAILEYS_NATIVE',
    profileName: baileysStatus.profileName || conn.profile_name,
    dailyStats,
    recentMessages
  });
});

// ════════════════════════════════════════════════════════
// 2. LEADS MANAGEMENT
// ════════════════════════════════════════════════════════
app.get('/api/v1/leads', (req, res) => {
  const d = getDb();
  const { category, status, search, page, limit } = req.query;

  let where = [];
  let params = [];

  if (category && category !== 'TODOS') {
    where.push('c.name = ?');
    params.push(category);
  }
  if (status && status !== 'TODOS') {
    where.push('l.status = ?');
    params.push(status);
  }
  if (search) {
    where.push("(l.name LIKE ? OR l.phone LIKE ? OR l.notes LIKE ?)");
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const pageNum = parseInt(page) || 1;
  const limitNum = (limit === 'all' || limit === '0' || parseInt(limit) === 0) 
    ? 100000 
    : Math.min(parseInt(limit) || 10000, 100000);
  const offset = (pageNum - 1) * limitNum;

  const countSql = `SELECT COUNT(*) as total FROM leads l LEFT JOIN categories c ON l.category_id = c.id ${whereClause}`;
  const total = d.prepare(countSql).get(...params).total;

  const sql = `
    SELECT l.*, c.name as category_name, c.color as category_color
    FROM leads l
    LEFT JOIN categories c ON l.category_id = c.id
    ${whereClause}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const leads = d.prepare(sql).all(...params, limitNum, offset);

  res.json({
    leads,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
  });
});

function normalizePhone(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (!cleaned) return '';
  if ((cleaned.length === 10 || cleaned.length === 11) && !cleaned.startsWith('55')) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
}

app.post('/api/v1/leads', (req, res) => {
  const d = getDb();
  const { phone, name, category, notes, initialConsent } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });

  const cleanedPhone = normalizePhone(phone);
  if (!cleanedPhone) return res.status(400).json({ error: 'Telefone inválido.' });

  // Check duplicate
  const existing = d.prepare('SELECT * FROM leads WHERE phone = ?').get(cleanedPhone);
  if (existing) return res.status(409).json({ error: 'Telefone já cadastrado.', lead: existing });

  // Find or auto-create category
  let categoryId = null;
  if (category) {
    let cat = d.prepare('SELECT id FROM categories WHERE name = ?').get(category);
    if (!cat) {
      const newCatId = generateId();
      d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)').run(newCatId, category, '#10b981', 'Criada automaticamente');
      categoryId = newCatId;
    } else {
      categoryId = cat.id;
    }
  }

  const status = initialConsent === 'OPT_IN' ? 'OPT_IN' : (initialConsent === 'OPT_OUT' ? 'OPT_OUT' : 'PENDING');
  const consentMethod = initialConsent === 'OPT_IN' ? 'MANUAL' : 'NONE';
  const consentTimestamp = initialConsent === 'OPT_IN' ? new Date().toISOString() : null;
  const id = generateId();

  d.prepare(`INSERT INTO leads (id, phone, name, category_id, status, consent_method, consent_timestamp, notes, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
    id, cleanedPhone, name, categoryId, status, consentMethod, consentTimestamp, notes || ''
  );

  // If PENDING and auto-opt-in enabled, send welcome message via WhatsApp
  if (status === 'PENDING') {
    const config = getSetting('optInConfig');
    if (config?.autoOptInOnFirstMessage) {
      sendWhatsAppMessage(cleanedPhone, config.welcomeMessage).then(result => {
        logMessage(id, cleanedPhone, name, config.welcomeMessage, 'OUTBOUND', 'OPT_IN_WELCOME', result?.messageId);
      }).catch(() => {
        logMessage(id, cleanedPhone, name, config.welcomeMessage, 'OUTBOUND', 'OPT_IN_WELCOME');
      });
    }
  }

  const newLead = d.prepare('SELECT l.*, c.name as category_name, c.color as category_color FROM leads l LEFT JOIN categories c ON l.category_id = c.id WHERE l.id = ?').get(id);
  res.status(201).json(newLead);
});

app.patch('/api/v1/leads/:id', (req, res) => {
  const d = getDb();
  const { id } = req.params;
  const lead = d.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

  const { name, category, status, notes } = req.body;
  const updates = [];
  const params = [];

  if (name) { updates.push('name = ?'); params.push(name); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (category) {
    let cat = d.prepare('SELECT id FROM categories WHERE name = ?').get(category);
    if (!cat) {
      const newCatId = generateId();
      d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)').run(newCatId, category, '#10b981', 'Criada automaticamente');
      updates.push('category_id = ?');
      params.push(newCatId);
    } else {
      updates.push('category_id = ?');
      params.push(cat.id);
    }
  }
  if (status && status !== lead.status) {
    updates.push('status = ?', 'consent_method = ?', "consent_timestamp = datetime('now')");
    params.push(status, 'MANUAL_OVERRIDE');
  }

  if (updates.length > 0) {
    params.push(id);
    d.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = d.prepare('SELECT l.*, c.name as category_name, c.color as category_color FROM leads l LEFT JOIN categories c ON l.category_id = c.id WHERE l.id = ?').get(id);
  res.json(updated);
});

app.delete('/api/v1/leads/:id', (req, res) => {
  const d = getDb();
  d.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Helper: Gerar CSV com codificação UTF-8 BOM para Excel
function generateLeadsCsv(leads) {
  const statusLabel = (st) => {
    if (st === 'OPT_IN') return 'Aceitou (Opt-in Confirmado)';
    if (st === 'OPT_OUT') return 'Recusou / Bloqueado (Opt-out)';
    return 'Aguardando Confirmacao (Pendente)';
  };

  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '""';
    const text = String(str).replace(/"/g, '""');
    return `"${text}"`;
  };

  const headers = [
    'ID',
    'Nome',
    'Telefone',
    'Categoria',
    'Status de Consentimento',
    'Metodo de Consentimento',
    'Data de Consentimento',
    'Envios Realizados',
    'Observacoes',
    'Data de Cadastro'
  ];

  const rows = leads.map(l => [
    escapeCsv(l.id),
    escapeCsv(l.name),
    escapeCsv(l.phone),
    escapeCsv(l.category_name || l.category || 'Sem Categoria'),
    escapeCsv(statusLabel(l.status)),
    escapeCsv(l.consent_method || 'Nenhum'),
    escapeCsv(l.consent_timestamp || ''),
    escapeCsv(l.messages_sent_count || 0),
    escapeCsv(l.notes || ''),
    escapeCsv(l.created_at || '')
  ].join(';'));

  return '\uFEFF' + headers.join(';') + '\r\n' + rows.join('\r\n');
}

// Export leads to CSV
app.get('/api/v1/leads/export', (req, res) => {
  const d = getDb();
  const { category, status, search } = req.query;

  let where = [];
  let params = [];

  if (category && category !== 'TODOS') {
    where.push('c.name = ?');
    params.push(category);
  }
  if (status && status !== 'TODOS') {
    where.push('l.status = ?');
    params.push(status);
  }
  if (search) {
    where.push("(l.name LIKE ? OR l.phone LIKE ? OR l.notes LIKE ?)");
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT l.*, c.name as category_name
    FROM leads l
    LEFT JOIN categories c ON l.category_id = c.id
    ${whereClause}
    ORDER BY l.created_at DESC
  `;
  const leads = d.prepare(sql).all(...params);
  const csv = generateLeadsCsv(leads);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_wappgr_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

app.post('/api/v1/leads/export', (req, res) => {
  const d = getDb();
  const { leadIds, category, status, search } = req.body;

  let where = [];
  let params = [];

  if (Array.isArray(leadIds) && leadIds.length > 0) {
    const placeholders = leadIds.map(() => '?').join(',');
    where.push(`l.id IN (${placeholders})`);
    params.push(...leadIds);
  } else {
    if (category && category !== 'TODOS') {
      where.push('c.name = ?');
      params.push(category);
    }
    if (status && status !== 'TODOS') {
      where.push('l.status = ?');
      params.push(status);
    }
    if (search) {
      where.push("(l.name LIKE ? OR l.phone LIKE ? OR l.notes LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q);
    }
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT l.*, c.name as category_name
    FROM leads l
    LEFT JOIN categories c ON l.category_id = c.id
    ${whereClause}
    ORDER BY l.created_at DESC
  `;
  const leads = d.prepare(sql).all(...params);
  const csv = generateLeadsCsv(leads);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_wappgr_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// Helper: Normalizar formato de data (brasileiro DD/MM/AAAA ou ISO) para SQLite
function normalizeDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s || s.toLowerCase() === 'nunca' || s.toLowerCase() === 'null' || s === '-') return null;
  
  const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    const hour = (brMatch[4] || '00').padStart(2, '0');
    const min = (brMatch[5] || '00').padStart(2, '0');
    const sec = (brMatch[6] || '00').padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  return null;
}

// Bulk import leads with direct Opt-In classification
app.post('/api/v1/leads/import', (req, res) => {
  const d = getDb();
  const { 
    leads: leadsData, 
    defaultCategory, 
    defaultStatus = 'OPT_IN', 
    updateExisting = false,
    useSpreadsheetCategories = false
  } = req.body;

  if (!Array.isArray(leadsData)) {
    return res.status(400).json({ error: 'Array de leads obrigatório.' });
  }

  const insertStmt = d.prepare(`
    INSERT INTO leads (id, phone, name, category_id, status, consent_method, consent_timestamp, notes, created_at, last_interaction) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
  `);

  const updateStmt = d.prepare(`
    UPDATE leads SET 
      name = CASE WHEN ? != '' THEN ? ELSE name END,
      category_id = COALESCE(?, category_id),
      status = ?,
      consent_method = ?,
      consent_timestamp = ?,
      notes = CASE WHEN ? != '' THEN ? ELSE notes END,
      last_interaction = CASE WHEN ? IS NOT NULL THEN ? ELSE last_interaction END
    WHERE id = ?
  `);

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  // Cache categories
  const catCache = new Map();
  const getOrCreateCategoryId = (catName) => {
    if (!catName) return null;
    const clean = String(catName).trim();
    if (!clean || clean.length > 40) return null;
    // Ignorar se for data (ex: 12/03/2024), hora, número puro ou link
    if (/^\d{1,2}\/\d{1,2}/.test(clean) || /^\d+$/.test(clean) || clean.includes('http') || clean.length < 2) return null;

    if (catCache.has(clean.toLowerCase())) return catCache.get(clean.toLowerCase());

    let cat = d.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(clean);
    if (!cat) {
      const newId = generateId();
      d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)').run(
        newId, clean, '#10b981', 'Criada automaticamente via importação'
      );
      catCache.set(clean.toLowerCase(), newId);
      return newId;
    }
    catCache.set(clean.toLowerCase(), cat.id);
    return cat.id;
  };

  const defaultCatId = defaultCategory ? getOrCreateCategoryId(defaultCategory) : null;

  const insertOrUpdateMany = d.transaction((items) => {
    for (const item of items) {
      const phone = normalizePhone(item.phone);
      if (!phone || !item.name) { 
        skipped++; 
        continue; 
      }

      const finalStatus = item.status || defaultStatus || 'OPT_IN';
      let consentMethod = 'IMPORT';
      let consentTimestamp = null;

      if (finalStatus === 'OPT_IN') {
        consentMethod = 'IMPORT_OPT_IN';
        consentTimestamp = new Date().toISOString();
      } else if (finalStatus === 'OPT_OUT') {
        consentMethod = 'IMPORT_OPT_OUT';
        consentTimestamp = new Date().toISOString();
      }

      let catId = defaultCatId;
      if (useSpreadsheetCategories && item.category) {
        const found = getOrCreateCategoryId(item.category);
        if (found) catId = found;
      }
      const createdAt = normalizeDate(item.created_at || item.since);
      const lastInteraction = normalizeDate(item.last_interaction || item.lastSent);

      const existing = d.prepare('SELECT id FROM leads WHERE phone = ?').get(phone);

      if (existing) {
        if (updateExisting) {
          updateStmt.run(
            item.name || '',
            item.name || '',
            catId,
            finalStatus,
            consentMethod,
            consentTimestamp,
            item.notes || '',
            item.notes || '',
            lastInteraction,
            lastInteraction,
            existing.id
          );
          updated++;
        } else {
          skipped++;
        }
      } else {
        insertStmt.run(
          generateId(),
          phone,
          item.name,
          catId,
          finalStatus,
          consentMethod,
          consentTimestamp,
          item.notes || '',
          createdAt,
          lastInteraction
        );
        imported++;
      }
    }
  });

  insertOrUpdateMany(leadsData);
  res.json({ 
    success: true, 
    imported, 
    updated, 
    skipped, 
    total: leadsData.length 
  });
});

// Bulk update leads (category or status)
app.post('/api/v1/leads/bulk-update', (req, res) => {
  const d = getDb();
  const { leadIds, category, status } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'Array de IDs de leads obrigatório.' });
  }

  let categoryId = undefined;
  if (category !== undefined) {
    if (category === '' || category === null) {
      categoryId = null;
    } else {
      let cat = d.prepare('SELECT id FROM categories WHERE name = ?').get(category);
      if (!cat) {
        categoryId = generateId();
        d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)').run(categoryId, category, '#10b981', 'Criada automaticamente');
      } else {
        categoryId = cat.id;
      }
    }
  }

  const updates = [];
  const params = [];

  if (categoryId !== undefined) {
    updates.push('category_id = ?');
    params.push(categoryId);
  }
  if (status !== undefined) {
    updates.push('status = ?', 'consent_method = ?', "consent_timestamp = datetime('now')");
    params.push(status, 'MANUAL_BULK_OVERRIDE');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar informado.' });
  }

  const updateStmt = d.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`);

  const runBulk = d.transaction((ids) => {
    let updatedCount = 0;
    for (const id of ids) {
      const result = updateStmt.run(...params, id);
      if (result.changes > 0) updatedCount++;
    }
    return updatedCount;
  });

  const updatedCount = runBulk(leadIds);
  res.json({ success: true, updated: updatedCount, total: leadIds.length });
});

// Bulk delete leads
app.post('/api/v1/leads/bulk-delete', (req, res) => {
  const d = getDb();
  const { leadIds } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'Array de IDs obrigatório.' });
  }

  const deleteStmt = d.prepare('DELETE FROM leads WHERE id = ?');
  const runDelete = d.transaction((ids) => {
    let deletedCount = 0;
    for (const id of ids) {
      const result = deleteStmt.run(id);
      if (result.changes > 0) deletedCount++;
    }
    return deletedCount;
  });

  const deletedCount = runDelete(leadIds);
  res.json({ success: true, deleted: deletedCount, total: leadIds.length });
});

// ════════════════════════════════════════════════════════
// 3. CATEGORIES
// ════════════════════════════════════════════════════════
app.get('/api/v1/categories', (req, res) => {
  const d = getDb();
  const categories = d.prepare(`
    SELECT c.*, COUNT(l.id) as count 
    FROM categories c 
    LEFT JOIN leads l ON l.category_id = c.id 
    GROUP BY c.id 
    ORDER BY c.name
  `).all();
  res.json(categories);
});

app.post('/api/v1/categories', (req, res) => {
  const d = getDb();
  const { name, color, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });

  const existing = d.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Categoria já existe.' });

  const id = generateId();
  d.prepare('INSERT INTO categories (id, name, color, description) VALUES (?, ?, ?, ?)').run(id, name, color || '#10b981', description || '');
  const cat = d.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.status(201).json(cat);
});

app.patch('/api/v1/categories/:id', (req, res) => {
  const d = getDb();
  const { id } = req.params;
  const { name, color, description } = req.body;

  const cat = d.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });

  const updates = [];
  const params = [];

  if (name && name !== cat.name) {
    const existing = d.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, id);
    if (existing) return res.status(409).json({ error: 'Já existe uma categoria com este nome.' });
    updates.push('name = ?');
    params.push(name);
  }
  if (color) {
    updates.push('color = ?');
    params.push(color);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }

  if (updates.length > 0) {
    params.push(id);
    d.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = d.prepare(`
    SELECT c.*, COUNT(l.id) as count 
    FROM categories c 
    LEFT JOIN leads l ON l.category_id = c.id 
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);

  res.json(updated);
});

app.delete('/api/v1/categories/:id', (req, res) => {
  const d = getDb();
  d.prepare('UPDATE leads SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  d.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Excluir múltiplas categorias em massa
app.post('/api/v1/categories/bulk-delete', (req, res) => {
  const { ids, reassignTo = null } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'IDs array required' });
  }
  const d = getDb();
  const placeholders = ids.map(() => '?').join(',');
  d.transaction(() => {
    if (reassignTo) {
      d.prepare(`UPDATE leads SET category_id = ? WHERE category_id IN (${placeholders})`).run(reassignTo, ...ids);
    } else {
      d.prepare(`UPDATE leads SET category_id = NULL WHERE category_id IN (${placeholders})`).run(...ids);
    }
    d.prepare(`DELETE FROM categories WHERE id IN (${placeholders})`).run(...ids);
  })();
  res.json({ success: true, count: ids.length });
});

// Função de auto-reparo e sanitização de categorias
function runAutoRepairCategories() {
  try {
    const d = getDb();
    let safeCat = d.prepare("SELECT id FROM categories WHERE name = 'Leads Orgânicos'").get();
    if (!safeCat) {
      const newId = generateId();
      d.prepare("INSERT INTO categories (id, name, color, description) VALUES (?, 'Leads Orgânicos', '#10b981', 'Categoria padrão')").run(newId);
      safeCat = { id: newId };
    }

    const allCats = d.prepare("SELECT id, name FROM categories").all();
    const corrupted = allCats.filter(c => {
      if (!c.name || !c.name.trim()) return true;
      const trimmed = c.name.trim();
      // Não possui letras nem números (ex: apenas símbolos como +, *, -, etc.)
      if (!/[a-zA-Z0-9\u00C0-\u00FF]/.test(trimmed)) return true;
      // Contém caractere de substituição UTF-8 (\uFFFD), controle (\x00-\x1F, \x7F-\x9F)
      if (/[\uFFFD\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return true;
      // Resíduos binários de zip / planilha Excel
      if (trimmed.includes('xml') || trimmed.includes('xl/') || trimmed.includes('Content_Types')) return true;
      // Tamanho excessivo gerado por corrupção
      if (trimmed.length > 45) return true;
      return false;
    });

    if (corrupted.length > 0) {
      const ids = corrupted.map(c => c.id);
      const placeholders = ids.map(() => '?').join(',');
      d.transaction(() => {
        d.prepare(`UPDATE leads SET category_id = ? WHERE category_id IN (${placeholders})`).run(safeCat.id, ...ids);
        d.prepare(`DELETE FROM categories WHERE id IN (${placeholders})`).run(...ids);
      })();
      console.log(`[Auto-Repair] ${corrupted.length} categorias corrompidas foram reparadas e seus leads transferidos para "Leads Orgânicos".`);
    }
  } catch (e) {
    console.error('[Auto-Repair Error]', e.message);
  }
}

// Limpar todas as categorias vazias (com 0 leads) - Suporta GET e POST
app.all('/api/v1/categories/cleanup-empty', (req, res) => {
  const d = getDb();
  const emptyCats = d.prepare(`
    SELECT c.id, c.name 
    FROM categories c 
    LEFT JOIN leads l ON l.category_id = c.id 
    GROUP BY c.id 
    HAVING COUNT(l.id) = 0
  `).all();

  if (emptyCats.length > 0) {
    const ids = emptyCats.map(c => c.id);
    const placeholders = ids.map(() => '?').join(',');
    d.prepare(`DELETE FROM categories WHERE id IN (${placeholders})`).run(...ids);
  }

  if (req.method === 'GET' && req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>WappGR - Limpeza de Categorias Vazias</title>
      <style>body{background:#090d16;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
      .card{background:#111827;border:1px solid #1f2937;padding:30px;border-radius:16px;max-width:500px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);}
      h2{color:#10b981;margin-top:0;}
      p{color:#94a3b8;font-size:14px;line-height:1.6;}
      a{display:inline-block;margin-top:20px;padding:10px 20px;background:#10b981;color:#090d16;text-decoration:none;font-weight:bold;border-radius:8px;}
      </style></head>
      <body>
        <div class="card">
          <h2>✅ Limpeza Concluída!</h2>
          <p>Foram removidas <strong>${emptyCats.length}</strong> categorias vazias.</p>
          <a href="/">Voltar para o WappGR</a>
        </div>
      </body></html>
    `);
  }

  res.json({ 
    success: true, 
    deletedCount: emptyCats.length, 
    deletedNames: emptyCats.map(c => c.name) 
  });
});

// Limpar categorias corrompidas ou com caracteres binários/estranhos e salvar os leads - Suporta GET e POST
app.all('/api/v1/categories/cleanup-corrupted', (req, res) => {
  const d = getDb();
  
  // Garantir categoria segura padrão
  let safeCat = d.prepare("SELECT id FROM categories WHERE name = 'Leads Orgânicos'").get();
  if (!safeCat) {
    const newId = generateId();
    d.prepare("INSERT INTO categories (id, name, color, description) VALUES (?, 'Leads Orgânicos', '#10b981', 'Categoria padrão')").run(newId);
    safeCat = { id: newId };
  }

  const allCats = d.prepare("SELECT id, name FROM categories").all();
  const corrupted = allCats.filter(c => {
    if (!c.name || !c.name.trim()) return true;
    const trimmed = c.name.trim();
    // Não possui letras nem números (ex: símbolos como +, *, etc.)
    if (!/[a-zA-Z0-9\u00C0-\u00FF]/.test(trimmed)) return true;
    // Contém caractere de substituição UTF-8 (\uFFFD), controle (\x00-\x1F, \x7F-\x9F)
    if (/[\uFFFD\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return true;
    // Resíduos binários
    if (trimmed.includes('xml') || trimmed.includes('xl/') || trimmed.includes('Content_Types')) return true;
    // Mais de 45 caracteres
    if (trimmed.length > 45) return true;
    return false;
  });

  let reallocatedLeads = 0;
  if (corrupted.length > 0) {
    const ids = corrupted.map(c => c.id);
    const placeholders = ids.map(() => '?').join(',');
    d.transaction(() => {
      // Reatribuir leads para a categoria segura para que o usuário não perca seus contatos
      const updateResult = d.prepare(`UPDATE leads SET category_id = ? WHERE category_id IN (${placeholders})`).run(safeCat.id, ...ids);
      reallocatedLeads = updateResult.changes || 0;
      // Excluir as categorias corrompidas
      d.prepare(`DELETE FROM categories WHERE id IN (${placeholders})`).run(...ids);
    })();
  }

  if (req.method === 'GET' && req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>WappGR - Reparo de Categorias</title>
      <style>body{background:#090d16;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
      .card{background:#111827;border:1px solid #1f2937;padding:30px;border-radius:16px;max-width:500px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);}
      h2{color:#10b981;margin-top:0;}
      p{color:#94a3b8;font-size:14px;line-height:1.6;}
      a{display:inline-block;margin-top:20px;padding:10px 20px;background:#10b981;color:#090d16;text-decoration:none;font-weight:bold;border-radius:8px;}
      </style></head>
      <body>
        <div class="card">
          <h2>🎉 Reparo Concluído com Sucesso!</h2>
          <p>Foram reparadas <strong>${corrupted.length}</strong> categorias corrompidas.</p>
          <p><strong>${reallocatedLeads}</strong> leads foram salvos e movidos com sucesso para a categoria <strong>"Leads Orgânicos"</strong>.</p>
          <a href="/">Voltar para o WappGR</a>
        </div>
      </body></html>
    `);
  }

  res.json({
    success: true,
    deletedCount: corrupted.length,
    deletedNames: corrupted.map(c => c.name),
    reallocatedLeads,
    targetCategory: 'Leads Orgânicos'
  });
});



// ════════════════════════════════════════════════════════
// 4. OPT-IN ENGINE
// ════════════════════════════════════════════════════════
app.get('/api/v1/optin/config', (req, res) => {
  res.json(getSetting('optInConfig') || {});
});

app.post('/api/v1/optin/config', (req, res) => {
  setSetting('optInConfig', req.body);
  res.json(req.body);
});

// Process incoming WhatsApp message
app.post('/api/v1/optin/process-message', async (req, res) => {
  const d = getDb();
  const { phone, messageText, name, whatsappMsgId } = req.body;
  if (!phone || !messageText) return res.status(400).json({ error: 'Telefone e texto obrigatórios.' });

  const cleanedPhone = phone.replace(/\D/g, '');
  const config = getSetting('optInConfig') || {};

  // Find or create lead
  let lead = d.prepare('SELECT * FROM leads WHERE phone = ?').get(cleanedPhone);

  if (!lead) {
    const defaultCat = d.prepare("SELECT id FROM categories WHERE name = 'Leads Orgânicos'").get();
    const id = generateId();
    d.prepare(`INSERT INTO leads (id, phone, name, category_id, status, consent_method, created_at) VALUES (?, ?, ?, ?, 'PENDING', 'NONE', datetime('now'))`)
      .run(id, cleanedPhone, name || `Contato ${cleanedPhone.slice(-4)}`, defaultCat?.id || null);
    lead = d.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  }

  // Log inbound
  logMessage(lead.id, lead.phone, lead.name, messageText, 'INBOUND', 'CHAT', whatsappMsgId);

  const textUpper = messageText.trim().toUpperCase();
  const yesKW = (config.yesKeywords || ['SIM', '1', 'QUERO', 'ACEITO']).map(k => k.toUpperCase());
  const noKW = (config.noKeywords || ['SAIR', '2', 'PARAR', 'CANCELAR']).map(k => k.toUpperCase());

  let replyText = null;
  let actionTaken = 'NONE';

  if (yesKW.includes(textUpper)) {
    d.prepare("UPDATE leads SET status = 'OPT_IN', consent_method = 'WHATSAPP_KEYWORD', consent_timestamp = datetime('now'), last_interaction = datetime('now') WHERE id = ?").run(lead.id);
    replyText = config.confirmationMessage || 'Cadastro ativado!';
    actionTaken = 'OPT_IN_ACTIVATED';
  } else if (noKW.includes(textUpper)) {
    d.prepare("UPDATE leads SET status = 'OPT_OUT', consent_method = 'OPT_OUT_REQUESTED', consent_timestamp = datetime('now'), last_interaction = datetime('now') WHERE id = ?").run(lead.id);
    replyText = config.optOutMessage || 'Você foi removido.';
    actionTaken = 'OPT_OUT_ACTIVATED';
  } else if (lead.status === 'PENDING' && config.autoOptInOnFirstMessage) {
    replyText = config.welcomeMessage;
    actionTaken = 'WELCOME_SENT';
  }

  d.prepare("UPDATE leads SET last_interaction = datetime('now') WHERE id = ?").run(lead.id);

  // Send reply via WhatsApp
  if (replyText) {
    const result = await sendWhatsAppMessage(cleanedPhone, replyText);
    logMessage(lead.id, lead.phone, lead.name, replyText, 'OUTBOUND', 'AUTO_REPLY', result?.messageId);
  }

  const updatedLead = d.prepare('SELECT l.*, c.name as category_name FROM leads l LEFT JOIN categories c ON l.category_id = c.id WHERE l.id = ?').get(lead.id);
  res.json({ lead: updatedLead, actionTaken, replyText });
});

// ════════════════════════════════════════════════════════
// 5. CAMPAIGNS / BROADCAST (REAL SENDING)
// ════════════════════════════════════════════════════════
app.get('/api/v1/campaigns', (req, res) => {
  const d = getDb();
  res.json(d.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all());
});

app.post('/api/v1/campaigns/send', async (req, res) => {
  const d = getDb();
  const { title, message, categoryFilter, pacingSeconds } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Título e mensagem obrigatórios.' });

  // STRICT: Only OPT_IN leads
  let sql = "SELECT l.*, c.name as category_name FROM leads l LEFT JOIN categories c ON l.category_id = c.id WHERE l.status = 'OPT_IN'";
  const params = [];
  if (categoryFilter && categoryFilter !== 'TODOS') {
    sql += ' AND c.name = ?';
    params.push(categoryFilter);
  }
  const targetLeads = d.prepare(sql).all(...params);

  if (targetLeads.length === 0) {
    return res.status(400).json({ error: 'Nenhum lead com Opt-in confirmado atende aos critérios.' });
  }

  const campId = generateId();
  d.prepare(`INSERT INTO campaigns (id, title, message, category_filter, total_target, status, pacing_seconds, created_at)
             VALUES (?, ?, ?, ?, ?, 'SENDING', ?, datetime('now'))`).run(
    campId, title, message, categoryFilter || 'TODOS', targetLeads.length, pacingSeconds || 10
  );

  res.status(201).json({
    campaign: { id: campId, title, status: 'SENDING', totalTarget: targetLeads.length },
    message: `Disparo iniciado para ${targetLeads.length} leads com Opt-in.`
  });

  // Background dispatch with real pacing
  const pacing = (pacingSeconds || 10) * 1000;
  let sentCount = 0;
  let failedCount = 0;

  for (const lead of targetLeads) {
    const personalizedText = message
      .replace(/{nome}/g, lead.name)
      .replace(/{categoria}/g, lead.category_name || '')
      .replace(/{telefone}/g, lead.phone);

    try {
      const target = lead.jid || lead.phone;
      const result = await sendWhatsAppMessage(target, personalizedText);
      if (result?.jid && (!lead.jid || lead.jid !== result.jid)) {
        d.prepare('UPDATE leads SET jid = ? WHERE id = ?').run(result.jid, lead.id);
      }
      if (result.success) {
        sentCount++;
        logMessage(lead.id, lead.phone, lead.name, personalizedText, 'OUTBOUND', 'BROADCAST', result.messageId, campId);
      } else {
        failedCount++;
        logMessage(lead.id, lead.phone, lead.name, `[FALHA] ${result.error}: ${personalizedText}`, 'OUTBOUND', 'BROADCAST_FAILED', null, campId);
      }
    } catch (err) {
      failedCount++;
      logMessage(lead.id, lead.phone, lead.name, `[ERRO] ${err.message}`, 'OUTBOUND', 'BROADCAST_FAILED', null, campId);
    }

    // Update progress
    d.prepare("UPDATE leads SET messages_sent_count = messages_sent_count + 1, last_interaction = datetime('now') WHERE id = ?").run(lead.id);
    d.prepare("UPDATE campaigns SET sent_count = ?, failed_count = ? WHERE id = ?").run(sentCount, failedCount, campId);

    // Pacing delay (randomized ±30% for anti-ban)
    const jitter = pacing * (0.7 + Math.random() * 0.6);
    await new Promise(resolve => setTimeout(resolve, jitter));
  }

  // Mark completed
  d.prepare("UPDATE campaigns SET status = 'COMPLETED', delivered_count = ?, sent_at = datetime('now') WHERE id = ?").run(sentCount, campId);
  console.log(`[Campaign] "${title}" concluída: ${sentCount} enviadas, ${failedCount} falhas.`);
});

// ════════════════════════════════════════════════════════
// 6. SCHEDULER (CRON)
// ════════════════════════════════════════════════════════
app.get('/api/v1/schedules', (req, res) => {
  const d = getDb();
  res.json(d.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all());
});

app.post('/api/v1/schedules', (req, res) => {
  const d = getDb();
  const { title, message, categoryFilter, recurrence, timeOfDay, specificDays, pacingSeconds } = req.body;
  if (!title || !message || !timeOfDay) return res.status(400).json({ error: 'Título, mensagem e horário obrigatórios.' });

  const id = generateId();
  d.prepare(`INSERT INTO schedules (id, title, message, category_filter, recurrence, time_of_day, specific_days, pacing_seconds, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
    id, title, message, categoryFilter || 'TODOS', recurrence || 'DAILY', timeOfDay,
    JSON.stringify(specificDays || []), pacingSeconds || 10
  );

  res.status(201).json(d.prepare('SELECT * FROM schedules WHERE id = ?').get(id));
});

app.patch('/api/v1/schedules/:id/toggle', (req, res) => {
  const d = getDb();
  d.prepare('UPDATE schedules SET active = NOT active WHERE id = ?').run(req.params.id);
  res.json(d.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id));
});

app.delete('/api/v1/schedules/:id', (req, res) => {
  const d = getDb();
  d.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════
// 7. CHAT (REAL MESSAGING)
// ════════════════════════════════════════════════════════
app.get('/api/v1/chat/messages', (req, res) => {
  const d = getDb();
  const { leadId, limit: lim } = req.query;
  const limitNum = Math.min(parseInt(lim) || 100, 500);

  if (leadId) {
    res.json(d.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY timestamp DESC LIMIT ?').all(leadId, limitNum));
  } else {
    res.json(d.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?').all(limitNum));
  }
});

app.post('/api/v1/chat/send', async (req, res) => {
  const d = getDb();
  const { leadId, text } = req.body;
  if (!leadId || !text) return res.status(400).json({ error: 'Lead e texto obrigatórios.' });

  const lead = d.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

  // Send real WhatsApp message via Baileys (using JID if available, else phone)
  const target = lead.jid || lead.phone;
  const result = await sendWhatsAppMessage(target, text);

  // If resolved JID is returned and lead doesn't have it, update lead
  if (result?.jid && (!lead.jid || lead.jid !== result.jid)) {
    d.prepare('UPDATE leads SET jid = ? WHERE id = ?').run(result.jid, lead.id);
  }

  const msgId = logMessage(lead.id, lead.phone, lead.name, text, 'OUTBOUND', 'DIRECT_CHAT', result?.messageId);
  d.prepare("UPDATE leads SET last_interaction = datetime('now') WHERE id = ?").run(leadId);

  res.json({
    id: msgId,
    success: result.success,
    whatsappMsgId: result?.messageId,
    error: result.success ? null : result.error
  });
});

// ════════════════════════════════════════════════════════
// 8. CONNECTION / BAILEYS NATIVE MANAGEMENT
// ════════════════════════════════════════════════════════
app.get('/api/v1/connection', (req, res) => {
  const d = getDb();
  const conn = d.prepare('SELECT * FROM connection WHERE id = 1').get() || {};
  const status = baileys.getStatus();
  res.json({
    ...conn,
    status: status.status || conn.status,
    phone: status.phone || conn.phone,
    profile_name: status.profileName || conn.profile_name,
    instance_type: 'BAILEYS_NATIVE'
  });
});

app.get('/api/v1/connection/qrcode', (req, res) => {
  const status = baileys.getStatus();
  res.json({
    success: true,
    status: status.status,
    qr: status.qr,
    phone: status.phone
  });
});

app.get('/api/v1/connection/status', (req, res) => {
  const d = getDb();
  const status = baileys.getStatus();
  const conn = d.prepare('SELECT * FROM connection WHERE id = 1').get() || {};

  res.json({
    success: true,
    baileysAlive: true,
    status: status.status || conn.status,
    phone: status.phone || conn.phone,
    profile_name: status.profileName || conn.profile_name,
    qr: status.qr,
    instance_type: 'BAILEYS_NATIVE'
  });
});

app.post('/api/v1/connection/start', async (req, res) => {
  await baileys.init();
  res.json({ success: true, message: 'Inicializando WhatsApp Web...' });
});

app.post('/api/v1/connection/logout', async (req, res) => {
  const d = getDb();
  await baileys.logout();
  d.prepare("UPDATE connection SET status = 'DISCONNECTED', phone = NULL, profile_name = NULL, connected_at = NULL WHERE id = 1").run();
  res.json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
});

// ════════════════════════════════════════════════════════
// 9. CRM WEBHOOKS (CRM READY)
// ════════════════════════════════════════════════════════
app.get('/api/v1/crm/config', (req, res) => {
  res.json(getSetting('webhooks') || {});
});

app.post('/api/v1/crm/config', (req, res) => {
  setSetting('webhooks', req.body);
  res.json(req.body);
});

app.post('/api/v1/crm/webhook/lead', (req, res) => {
  const apiKeyHeader = req.headers['x-api-key'] || req.query.api_key;
  const webhooks = getSetting('webhooks') || {};

  if (apiKeyHeader !== webhooks.apiKey) {
    return res.status(401).json({ error: 'API Key inválida.' });
  }

  const d = getDb();
  const { phone, name, category, optInConfirmed, notes } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Telefone e nome obrigatórios.' });

  const cleanedPhone = phone.replace(/\D/g, '');
  let lead = d.prepare('SELECT * FROM leads WHERE phone = ?').get(cleanedPhone);

  if (lead) {
    d.prepare('UPDATE leads SET name = ? WHERE id = ?').run(name, lead.id);
    if (category) {
      const cat = d.prepare('SELECT id FROM categories WHERE name = ?').get(category);
      if (cat) d.prepare('UPDATE leads SET category_id = ? WHERE id = ?').run(cat.id, lead.id);
    }
    if (optInConfirmed) {
      d.prepare("UPDATE leads SET status = 'OPT_IN', consent_method = 'FORM_WEBHOOK', consent_timestamp = datetime('now') WHERE id = ?").run(lead.id);
    }
  } else {
    const id = generateId();
    let catId = null;
    if (category) {
      const cat = d.prepare('SELECT id FROM categories WHERE name = ?').get(category);
      catId = cat?.id || null;
    }
    d.prepare(`INSERT INTO leads (id, phone, name, category_id, status, consent_method, consent_timestamp, notes, created_at) VALUES (?, ?, ?, ?, ?, 'FORM_WEBHOOK', ?, ?, datetime('now'))`)
      .run(id, cleanedPhone, name, catId, optInConfirmed ? 'OPT_IN' : 'PENDING', optInConfirmed ? new Date().toISOString() : null, notes || '');
    lead = d.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  }

  lead = d.prepare('SELECT l.*, c.name as category_name FROM leads l LEFT JOIN categories c ON l.category_id = c.id WHERE l.id = ?').get(lead.id);
  res.json({ success: true, lead });
});

// ════════════════════════════════════════════════════════
// 10. FLOWS & INTERACTIVE FUNNELS
// ════════════════════════════════════════════════════════
app.get('/api/v1/flows', (req, res) => {
  const d = getDb();
  const flows = d.prepare('SELECT * FROM flows ORDER BY created_at DESC').all();
  const flowsWithCounts = flows.map(f => {
    const activeSessions = d.prepare('SELECT COUNT(*) as c FROM lead_flow_sessions WHERE flow_id = ?').get(f.id).c;
    return {
      ...f,
      steps: (() => { try { return JSON.parse(f.steps_json); } catch { return []; } })(),
      activeSessions
    };
  });
  res.json(flowsWithCounts);
});

app.get('/api/v1/flows/:id', (req, res) => {
  const d = getDb();
  const flow = d.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado.' });
  res.json({
    ...flow,
    steps: (() => { try { return JSON.parse(flow.steps_json); } catch { return []; } })()
  });
});

app.post('/api/v1/flows', (req, res) => {
  const d = getDb();
  const { name, trigger_type, trigger_keywords, description, steps } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome do fluxo é obrigatório.' });

  const id = generateId();
  const stepsJson = JSON.stringify(steps || []);

  d.prepare(`INSERT INTO flows (id, name, trigger_type, trigger_keywords, description, active, steps_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`).run(
    id, name, trigger_type || 'KEYWORD', trigger_keywords || '', description || '', stepsJson
  );

  const created = d.prepare('SELECT * FROM flows WHERE id = ?').get(id);
  res.status(201).json({
    ...created,
    steps: steps || []
  });
});

app.patch('/api/v1/flows/:id', (req, res) => {
  const d = getDb();
  const { id } = req.params;
  const { name, trigger_type, trigger_keywords, description, steps, active } = req.body;

  const flow = d.prepare('SELECT * FROM flows WHERE id = ?').get(id);
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado.' });

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (trigger_type !== undefined) { updates.push('trigger_type = ?'); params.push(trigger_type); }
  if (trigger_keywords !== undefined) { updates.push('trigger_keywords = ?'); params.push(trigger_keywords); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (steps !== undefined) { updates.push('steps_json = ?'); params.push(JSON.stringify(steps)); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }

  updates.push("updated_at = datetime('now')");

  if (updates.length > 0) {
    params.push(id);
    d.prepare(`UPDATE flows SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = d.prepare('SELECT * FROM flows WHERE id = ?').get(id);
  res.json({
    ...updated,
    steps: (() => { try { return JSON.parse(updated.steps_json); } catch { return []; } })()
  });
});

app.patch('/api/v1/flows/:id/toggle', (req, res) => {
  const d = getDb();
  d.prepare("UPDATE flows SET active = NOT active, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  const updated = d.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/v1/flows/:id', (req, res) => {
  const d = getDb();
  d.prepare('DELETE FROM lead_flow_sessions WHERE flow_id = ?').run(req.params.id);
  d.prepare('DELETE FROM flows WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Trigger flow manually for a lead
app.post('/api/v1/flows/:id/trigger-lead', async (req, res) => {
  const d = getDb();
  const { id } = req.params;
  const { leadId } = req.body;

  const flow = d.prepare('SELECT * FROM flows WHERE id = ?').get(id);
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado.' });

  const lead = d.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

  let steps = [];
  try { steps = JSON.parse(flow.steps_json); } catch {}
  if (steps.length === 0) return res.status(400).json({ error: 'Fluxo não possui etapas configuradas.' });

  await executeFlowStep(lead, flow, steps[0]);
  res.json({ success: true, message: `Fluxo "${flow.name}" iniciado para ${lead.name}.` });
});

// ════════════════════════════════════════════════════════
// CRON SCHEDULER (EVERY_OTHER_DAY + SPECIFIC_DAYS)
// ════════════════════════════════════════════════════════
cron.schedule('* * * * *', async () => {
  const d = getDb();
  const schedules = d.prepare("SELECT * FROM schedules WHERE active = 1").all();
  const now = new Date();
  const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const dayOfWeek = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];

  for (const sched of schedules) {
    if (sched.time_of_day !== currentHHMM) continue;

    // Guard: already ran this minute?
    if (sched.last_run_at) {
      const lastRun = new Date(sched.last_run_at);
      const diffMs = now.getTime() - lastRun.getTime();
      if (diffMs < 120000) continue;
    }

    // Check recurrence rules
    if (sched.recurrence === 'EVERY_OTHER_DAY') {
      if (sched.last_run_at) {
        const lastRun = new Date(sched.last_run_at);
        const diffDays = Math.floor((now.getTime() - lastRun.getTime()) / 86400000);
        if (diffDays < 2) continue;
      }
    }

    if (sched.recurrence === 'SPECIFIC_DAYS') {
      let days = [];
      try { days = JSON.parse(sched.specific_days); } catch {}
      if (!days.includes(dayOfWeek)) continue;
    }

    // Execute! Get OPT_IN leads for this schedule's category
    let sql = "SELECT l.*, c.name as category_name FROM leads l LEFT JOIN categories c ON l.category_id = c.id WHERE l.status = 'OPT_IN'";
    const params = [];
    if (sched.category_filter && sched.category_filter !== 'TODOS') {
      sql += ' AND c.name = ?';
      params.push(sched.category_filter);
    }
    const targets = d.prepare(sql).all(...params);

    if (targets.length === 0) continue;

    console.log(`[Cron] Executando agendamento "${sched.title}" para ${targets.length} leads...`);

    const pacing = (sched.pacing_seconds || 10) * 1000;
    for (const lead of targets) {
      const text = sched.message
        .replace(/{nome}/g, lead.name)
        .replace(/{categoria}/g, lead.category_name || '');

      try {
        const target = lead.jid || lead.phone;
        const result = await sendWhatsAppMessage(target, text);
        if (result?.jid && (!lead.jid || lead.jid !== result.jid)) {
          d.prepare('UPDATE leads SET jid = ? WHERE id = ?').run(result.jid, lead.id);
        }
        logMessage(lead.id, lead.phone, lead.name, text, 'OUTBOUND', 'SCHEDULED_CRON', result?.messageId);
        d.prepare("UPDATE leads SET messages_sent_count = messages_sent_count + 1, last_interaction = datetime('now') WHERE id = ?").run(lead.id);
      } catch (err) {
        logMessage(lead.id, lead.phone, lead.name, `[CRON ERRO] ${err.message}`, 'OUTBOUND', 'CRON_FAILED');
      }

      const jitter = pacing * (0.7 + Math.random() * 0.6);
      await new Promise(resolve => setTimeout(resolve, jitter));
    }

    d.prepare("UPDATE schedules SET last_run_at = datetime('now') WHERE id = ?").run(sched.id);
    console.log(`[Cron] Agendamento "${sched.title}" concluído.`);
  }
});

// ════════════════════════════════════════════════════════
// SERVE PRODUCTION FRONTEND (CONTABO / VPS DEPLOYMENT)
// ════════════════════════════════════════════════════════
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

// ════════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 WappGR Backend rodando na porta ${PORT}`);
  console.log(`📦 Banco SQLite: server/wappgr.db`);
  console.log(`📱 WhatsApp Baileys Nativo: Inicializado`);
  runAutoRepairCategories();
});
