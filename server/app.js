const express = require("express");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { installAuth } = require("./auth");
const { id, utc, fail, text, page, integer } = require("./domain");
const { Leads } = require("./leads");
const { canSend } = require("./policy");
const { validateFlow } = require("./flows");
const { nextOccurrence } = require("./time");
function createApp({
  db,
  campaigns,
  dispatcher,
  scheduler,
  flows,
  provider,
  now = Date.now,
  origins,
  getHealth,
  isShuttingDown = () => false,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", (req, res, next) => {
    if (isShuttingDown())
      return res
        .status(503)
        .json({ error: "Servidor encerrando; tente novamente após iniciar." });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.body === undefined) req.body = {};
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
        fail("O corpo da requisição deve ser um objeto JSON.");
    }
    next();
  });
  installAuth(app, db, { origins, now });
  const leads = new Leads(db, { now }),
    base = "/api/v1";
  const setting = (key) =>
    JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ||
        "{}",
    );
  const saveSetting = (key, value) =>
    db
      .prepare(
        "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      )
      .run(key, JSON.stringify(value), utc(now()));
  const actor = (req) => req.auth?.username || "webhook";
  const key = (req) => req.get("Idempotency-Key");
  app.get(base + "/health", (req, res) => {
    const health = getHealth
      ? getHealth()
      : {
          pid: process.pid,
          transport: "BAILEYS",
          dispatcher: { busy: dispatcher.busy },
        };
    res.status(health.state === "DEGRADED" ? 503 : 200).json(health);
  });
  const selected = (body) =>
    body.selection ||
    (body.leadIds
      ? { type: "ids", ids: body.leadIds }
      : { type: "filters", filters: body });
  const download = (res, value, name) =>
    res.type("text/csv").attachment(name).send(value);
  app.get(base + "/dashboard/stats", (req, res) => {
    const count = (sql, ...args) => db.prepare(sql).get(...args).n;
    const totalLeads = count("SELECT COUNT(*) n FROM leads");
    const optedInCount = count(
      "SELECT COUNT(*) n FROM leads WHERE status='OPT_IN'",
    );
    const optedOutCount = count(
      "SELECT COUNT(*) n FROM leads WHERE status='OPT_OUT'",
    );
    const totalSent = count(
      "SELECT COUNT(*) n FROM messages WHERE direction='OUTBOUND' AND status IN ('SENT','DELIVERED','READ')",
    );
    const totalDelivered = count(
      "SELECT COUNT(*) n FROM messages WHERE direction='OUTBOUND' AND status IN ('DELIVERED','READ')",
    );
    const dailyStats = [];
    for (let i = 6; i >= 0; i--) {
      const day = utc(now() - i * 86400000).slice(0, 10);
      dailyStats.push({
        day,
        sent: count(
          "SELECT COUNT(*) n FROM messages WHERE substr(timestamp,1,10)=? AND direction='OUTBOUND' AND status IN ('SENT','DELIVERED','READ')",
          day,
        ),
        received: count(
          "SELECT COUNT(*) n FROM messages WHERE substr(timestamp,1,10)=? AND direction='INBOUND'",
          day,
        ),
      });
    }
    res.json({
      totalLeads,
      optedInCount,
      optedOutCount,
      pendingCount: totalLeads - optedInCount - optedOutCount,
      optInRate: totalLeads ? Math.round((optedInCount / totalLeads) * 100) : 0,
      totalSent,
      totalDelivered,
      totalAttempts: count("SELECT COUNT(*) n FROM send_attempts"),
      totalUncertain: count(
        "SELECT COUNT(*) n FROM messages WHERE status='UNCERTAIN'",
      ),
      activeSchedules: count("SELECT COUNT(*) n FROM schedules WHERE active=1"),
      dailyStats,
      recentMessages: db
        .prepare(
          "SELECT *,lead_name leadName,lead_phone leadPhone FROM messages ORDER BY timestamp DESC LIMIT 15",
        )
        .all(),
      connection: provider.getStatus(),
    });
  });
  app.get(base + "/leads", (req, res) => res.json(leads.list(req.query)));
  app.post(base + "/leads", (req, res) =>
    res.status(201).json(leads.create(req.body, actor(req))),
  );
  app.get(base + "/leads/export", (req, res) =>
    download(res, leads.export(selected(req.query)), "leads_wappgr.csv"),
  );
  app.post(base + "/leads/export", (req, res) =>
    download(res, leads.export(selected(req.body)), "leads_wappgr.csv"),
  );
  app.post(base + "/leads/import", (req, res) =>
    res.json(leads.import(req.body, actor(req))),
  );
  app.post(base + "/leads/bulk-update", (req, res) => {
    const rows = leads.selected(selected(req.body));
    const changes = req.body.updates || req.body;
    db.transaction(() =>
      rows.forEach((row) => leads.update(row.id, changes, actor(req))),
    )();
    res.json({ updated: rows.length });
  });
  app.post(base + "/leads/bulk-delete", (req, res) => {
    const rows = leads.selected(selected(req.body));
    db.transaction(() =>
      rows.forEach((row) =>
        db.prepare("DELETE FROM leads WHERE id=?").run(row.id),
      ),
    )();
    res.json({ deleted: rows.length });
  });
  app.patch(base + "/leads/:id", (req, res) =>
    res.json(leads.update(req.params.id, req.body, actor(req))),
  );
  app.delete(base + "/leads/:id", (req, res) => {
    leads.get(req.params.id);
    db.prepare("DELETE FROM leads WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });
  const categories = () =>
    db
      .prepare(
        "SELECT c.*,COUNT(l.id) lead_count FROM categories c LEFT JOIN leads l ON l.category_id=c.id GROUP BY c.id ORDER BY c.name",
      )
      .all();
  const categoryUsed = (cat) =>
    db.prepare("SELECT id FROM schedules WHERE category_id=?").get(cat.id) ||
    db
      .prepare("SELECT steps_json FROM flows")
      .all()
      .some((f) =>
        JSON.parse(f.steps_json).some(
          (s) => s.changeCategoryId === cat.id || s.changeCategory === cat.name,
        ),
      );
  const removeCategories = (ids, reassignTo) =>
    db.transaction(() => {
      if (!Array.isArray(ids) || ids.length > 10000) fail("IDs inválidos.");
      if (
        reassignTo &&
        (ids.includes(reassignTo) ||
          !db.prepare("SELECT id FROM categories WHERE id=?").get(reassignTo))
      )
        fail("Destino inválido.");
      for (const catId of ids) {
        const cat = db
          .prepare("SELECT * FROM categories WHERE id=?")
          .get(catId);
        if (!cat) continue;
        if (categoryUsed(cat))
          fail("Categoria usada em fluxo ou agendamento: " + cat.name, 409);
        if (reassignTo)
          db.prepare("UPDATE leads SET category_id=? WHERE category_id=?").run(
            reassignTo,
            catId,
          );
        db.prepare("DELETE FROM categories WHERE id=?").run(catId);
      }
      return { count: ids.length, deletedCount: ids.length };
    })();
  app.get(base + "/categories", (req, res) => res.json(categories()));
  app.post(base + "/categories", (req, res) => {
    const catId = id();
    db.prepare(
      "INSERT INTO categories(id,name,color,description) VALUES(?,?,?,?)",
    ).run(
      catId,
      text(req.body.name, "Nome", 120),
      /^#[a-f\d]{6}$/i.test(req.body.color) ? req.body.color : "#10b981",
      String(req.body.description || "").slice(0, 1000),
    );
    res.status(201).json({ id: catId });
  });
  app.patch(base + "/categories/:id", (req, res) => {
    const old = db
      .prepare("SELECT * FROM categories WHERE id=?")
      .get(req.params.id);
    if (!old) fail("Categoria não encontrada.", 404);
    db.prepare(
      "UPDATE categories SET name=?,color=?,description=? WHERE id=?",
    ).run(
      req.body.name === undefined ? old.name : text(req.body.name, "Nome", 120),
      req.body.color || old.color,
      req.body.description ?? old.description,
      old.id,
    );
    res.json({ success: true });
  });
  app.delete(base + "/categories/:id", (req, res) =>
    res.json(removeCategories([req.params.id], null)),
  );
  app.post(base + "/categories/bulk-delete", (req, res) =>
    res.json(removeCategories(req.body.ids, req.body.reassignTo)),
  );
  const repairPreview = (kind) =>
    categories().filter(
      (c) =>
        !categoryUsed(c) &&
        (kind === "empty"
          ? c.lead_count === 0
          : !c.name.trim() ||
            [...c.name].some(
              (char) => char.charCodeAt(0) < 32 || char === "\uFFFD",
            )),
    );
  app.get(base + "/categories/repair-preview", (req, res) =>
    res.json(repairPreview(req.query.kind)),
  );
  for (const kind of ["empty", "corrupted"])
    app.post(base + "/categories/cleanup-" + kind, (req, res) => {
      if (!Array.isArray(req.body.ids))
        fail("Revise a prévia e envie os IDs explicitamente.");
      const allowed = new Set(repairPreview(kind).map((c) => c.id));
      if (req.body.ids.some((x) => !allowed.has(x)))
        fail("A prévia mudou; revise novamente.", 409);
      res.json(removeCategories(req.body.ids, req.body.reassignTo));
    });
  app.get(base + "/optin/config", (req, res) =>
    res.json(setting("optInConfig")),
  );
  app.post(base + "/optin/config", (req, res) => {
    const b = req.body;
    for (const field of ["yesKeywords", "noKeywords"])
      if (
        !Array.isArray(b[field]) ||
        b[field].length > 50 ||
        b[field].some(
          (x) => typeof x !== "string" || !x.trim() || /^\d+$/.test(x.trim()),
        )
      )
        fail(
          "Palavras de consentimento devem ser textos, sem opções numéricas.",
        );
    const yes = b.yesKeywords.map((x) => x.trim().toUpperCase()),
      no = [
        ...new Set([
          "SAIR",
          "PARAR",
          "CANCELAR",
          "DESCADASTRAR",
          ...b.noKeywords.map((x) => x.trim().toUpperCase()),
        ]),
      ];
    if (yes.some((x) => no.includes(x)))
      fail("Uma palavra não pode aprovar e cancelar consentimento.");
    const config = {
      autoOptInOnFirstMessage: !!b.autoOptInOnFirstMessage,
      yesKeywords: yes,
      noKeywords: no,
      welcomeMessage: String(b.welcomeMessage || "").slice(0, 10000),
      confirmationMessage: String(b.confirmationMessage || "").slice(0, 10000),
      optOutMessage: String(b.optOutMessage || "").slice(0, 10000),
    };
    saveSetting("optInConfig", config);
    res.json(config);
  });
  app.post(base + "/optin/process-message", (req, res) => {
    const cfg = setting("optInConfig"),
      word = text(req.body.messageText, "Mensagem", 10000).toUpperCase();
    const no = [
      ...new Set([
        "SAIR",
        "PARAR",
        "CANCELAR",
        "DESCADASTRAR",
        ...(cfg.noKeywords || []),
      ]),
    ];
    const status = no.includes(word)
      ? "OPT_OUT"
      : (cfg.yesKeywords || []).includes(word)
        ? "OPT_IN"
        : "PENDING";
    const response =
      status === "OPT_OUT"
        ? cfg.optOutMessage
        : status === "OPT_IN"
          ? cfg.confirmationMessage
          : cfg.welcomeMessage;
    res.json({
      simulation: true,
      status,
      actionTaken:
        status === "OPT_IN"
          ? "OPT_IN_ACTIVATED"
          : status === "OPT_OUT"
            ? "OPT_OUT_ACTIVATED"
            : "PENDING",
      lead: { name: req.body.name || "Simulação", status },
      response,
      reply: response,
      replyText: response,
      leadStatus: status,
      autoReply: response,
      message: "Simulação isolada: nenhum dado salvo e nenhum envio.",
    });
  });
  app.post(base + "/campaigns/preview", (req, res) =>
    res.json(campaigns.audience(req.body.selection || req.body).summary),
  );
  app.get(base + "/campaigns", (req, res) => res.json(campaigns.list()));
  for (const route of ["/campaigns", "/campaigns/send"])
    app.post(base + route, (req, res) =>
      res.status(201).json(campaigns.create(req.body, key(req), actor(req))),
    );
  app.get(base + "/campaigns/:id", (req, res) =>
    res.json(campaigns.get(req.params.id)),
  );
  app.get(base + "/campaigns/:id/recipients", (req, res) =>
    res.json(campaigns.recipients(req.params.id, req.query)),
  );
  app.get(base + "/campaigns/:id/events", (req, res) => {
    campaigns.get(req.params.id);
    const after = integer(
      req.query.after,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      "Evento",
    );
    res.json(
      db
        .prepare(
          "SELECT * FROM campaign_events WHERE campaign_id=? AND id>? ORDER BY id DESC LIMIT 100",
        )
        .all(req.params.id, after)
        .map((e) => ({ ...e, details: JSON.parse(e.details) })),
    );
  });
  app.get(base + "/campaigns/:id/export", (req, res) =>
    download(
      res,
      campaigns.export(req.params.id),
      "campanha-" + req.params.id + ".csv",
    ),
  );
  for (const action of [
    "start",
    "pause",
    "resume",
    "cancel",
    "authorize-next",
    "retry",
  ])
    app.post(base + "/campaigns/:id/" + action, (req, res) =>
      res.json(
        campaigns.control(
          req.params.id,
          action,
          req.body || {},
          key(req),
          actor(req),
        ),
      ),
    );
  app.get(base + "/schedules", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM schedules ORDER BY created_at DESC")
        .all()
        .map((s) => ({
          ...s,
          specificDays: JSON.parse(s.specific_days),
          executions: db
            .prepare(
              "SELECT * FROM schedule_occurrences WHERE schedule_id=? ORDER BY due_at DESC LIMIT 10",
            )
            .all(s.id),
        })),
    ),
  );
  app.post(base + "/schedules", (req, res) =>
    res
      .status(201)
      .json(
        campaigns.once("create-schedule", key(req), req.body, () =>
          scheduler.create(req.body),
        ),
      ),
  );
  app.patch(base + "/schedules/:id/toggle", (req, res) => {
    const s = db
      .prepare("SELECT * FROM schedules WHERE id=?")
      .get(req.params.id);
    if (!s) fail("Regra não encontrada.", 404);
    const next = s.active ? null : nextOccurrence(s, now());
    if (!s.active && !next) fail("Regra sem próximas ocorrências.", 409);
    db.prepare("UPDATE schedules SET active=?,next_run_at=? WHERE id=?").run(
      s.active ? 0 : 1,
      next,
      s.id,
    );
    res.json({
      success: true,
      message:
        "Alteradas somente ocorrências futuras; execuções existentes são controladas nas campanhas.",
    });
  });
  app.delete(base + "/schedules/:id", (req, res) => {
    db.prepare("DELETE FROM schedules WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });
  app.get(base + "/chat/messages", (req, res) => {
    if (!req.query.leadId)
      return res.json({
        messages: [],
        jobs: [],
        pagination: { page: 1, total: 0, totalPages: 0 },
      });
    leads.get(req.query.leadId);
    const { page: p, limit } = page(req.query);
    const total = db
      .prepare("SELECT COUNT(*) n FROM messages WHERE lead_id=?")
      .get(req.query.leadId).n;
    res.json({
      messages: db
        .prepare(
          "SELECT * FROM messages WHERE lead_id=? ORDER BY timestamp DESC,id LIMIT ? OFFSET ?",
        )
        .all(req.query.leadId, limit, (p - 1) * limit)
        .reverse(),
      jobs: db
        .prepare(
          "SELECT id,lead_id,kind,status,error,created_at,payload_json FROM outbound_jobs WHERE lead_id=? AND status IN ('PENDING','SKIPPED','CANCELLED') ORDER BY created_at DESC LIMIT 50",
        )
        .all(req.query.leadId),
      pagination: {
        page: p,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });
  app.post(base + "/chat/send", (req, res) =>
    res.json(
      campaigns.once("chat-send", key(req), req.body, () => {
        const lead = leads.get(req.body.leadId),
          reason = canSend(lead, "HUMAN_REPLY", now());
        if (reason) fail(reason, 409);
        const job = dispatcher.enqueue({
          lead,
          kind: "HUMAN_REPLY",
          payload: {
            type: "TEXT",
            text: text(req.body.text, "Mensagem", 10000),
          },
          priority: 0,
          actor: actor(req),
        });
        return { success: true, queued: true, job };
      }),
    ),
  );
  for (const path of [
    "/connection",
    "/connection/status",
    "/connection/qrcode",
  ])
    app.get(base + path, (req, res) =>
      res.json({
        ...provider.getStatus(),
        qr: provider.getStatus().qrCode,
        account: dispatcher.accountStatus(),
        transport: "BAILEYS",
      }),
    );
  app.post(base + "/connection/restrict", (req, res) =>
    res.json(
      campaigns.once("restrict-account", key(req), req.body, () => {
        const reason = text(req.body.reason, "Motivo da suspensão", 1000);
        const hours = integer(
          req.body.hours,
          24,
          0,
          720,
          "Prazo mínimo em horas",
        );
        dispatcher.restrictAccount(
          reason,
          hours ? utc(now() + hours * 3600000) : null,
          actor(req),
        );
        return dispatcher.accountStatus();
      }),
    ),
  );
  app.post(base + "/connection/review-release", (req, res) =>
    res.json(
      campaigns.once("release-account", key(req), req.body, () => {
        if (req.body.reviewed !== true) fail("Confirme a revisão operacional.");
        dispatcher.releaseAccount(
          text(req.body.reason, "Registro da revisão", 1000),
          actor(req),
        );
        return dispatcher.accountStatus();
      }),
    ),
  );
  app.post(base + "/connection/start", async (req, res) => {
    await provider.init();
    res.json({ success: true, ...provider.getStatus() });
  });
  app.post(base + "/connection/logout", async (req, res) => {
    await provider.logout();
    res.json({ success: true, ...provider.getStatus() });
  });
  const crmPublic = () => {
    const c = setting("webhooks");
    return {
      configured: !!c.apiKey,
      publicBaseUrl: c.publicBaseUrl || "",
      outboundSupported: false,
    };
  };
  app.get(base + "/crm/config", (req, res) => res.json(crmPublic()));
  app.post(base + "/crm/config", (req, res) => {
    const c = setting("webhooks");
    let publicBaseUrl = "";
    if (req.body.publicBaseUrl) {
      let u;
      try {
        u = new URL(req.body.publicBaseUrl);
      } catch {
        fail("URL inválida.");
      }
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        fail("URL inválida.");
      publicBaseUrl = u.origin;
    }
    const config = { apiKey: c.apiKey, publicBaseUrl };
    saveSetting("webhooks", config);
    res.json(crmPublic());
  });
  app.post(base + "/crm/rotate-key", (req, res) => {
    const c = setting("webhooks"),
      apiKey = randomBytes(32).toString("hex");
    saveSetting("webhooks", { apiKey, publicBaseUrl: c.publicBaseUrl || "" });
    res.json({
      apiKey,
      message: "Copie agora. A chave não será exibida novamente.",
    });
  });
  app.post(base + "/crm/simulate", (req, res) => {
    const phone = require("./domain").normalizePhone(req.body.phone);
    if (!phone) fail("Telefone inválido.");
    text(req.body.name, "Nome", 200);
    res.json({
      simulation: true,
      phone,
      message: "JSON válido. Nenhum contato criado e nenhum envio.",
    });
  });
  app.post(base + "/crm/webhook/lead", (req, res) => {
    const expected = setting("webhooks").apiKey,
      provided = req.get("x-api-key");
    if (typeof expected !== "string" || !expected.length)
      fail("Webhook não configurado.", 503, "WEBHOOK_DISABLED");
    if (
      typeof provided !== "string" ||
      Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      fail("Chave inválida.", 401, "AUTH");
    const b = req.body,
      phone = require("./domain").normalizePhone(b.phone);
    if (!phone) fail("Telefone inválido.");
    text(b.name, "Nome", 200);
    const old = db.prepare("SELECT * FROM leads WHERE phone=?").get(phone);
    const categoryId =
      b.categoryId ||
      (b.category
        ? db.prepare("SELECT id FROM categories WHERE name=?").get(b.category)
            ?.id
        : null);
    const evidence =
      b.optInConfirmed === true &&
      typeof b.consentEvidence === "string" &&
      b.consentEvidence.trim().length >= 5;
    const result = db.transaction(() => {
      if (old) {
        leads.update(
          old.id,
          {
            name: b.name,
            ...(categoryId ? { categoryId } : {}),
            ...(b.notes === undefined ? {} : { notes: b.notes }),
          },
          "webhook",
        );
        return leads.get(old.id);
      }
      return leads.create(
        {
          name: b.name,
          phone: "+" + phone,
          categoryId,
          notes: b.notes,
          status: evidence ? "OPT_IN" : "PENDING",
          consentEvidence: evidence,
          consentReason: evidence ? b.consentEvidence : undefined,
        },
        "webhook",
        "FORM_WEBHOOK",
      );
    })();
    res.json({ lead: result, consentPreserved: !!old });
  });
  const flowView = (row) => ({
    ...row,
    steps: JSON.parse(row.steps_json),
    activeSessions: db
      .prepare("SELECT COUNT(*) n FROM lead_flow_sessions WHERE flow_id=?")
      .get(row.id).n,
  });
  const getFlow = (flowId) => {
    const f = db.prepare("SELECT * FROM flows WHERE id=?").get(flowId);
    if (!f) fail("Fluxo não encontrado.", 404);
    return f;
  };
  app.get(base + "/flows", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM flows ORDER BY created_at,id")
        .all()
        .map(flowView),
    ),
  );
  app.get(base + "/flows/:id", (req, res) =>
    res.json(flowView(getFlow(req.params.id))),
  );
  const saveFlow = (body, flowId) => {
    const steps = validateFlow(body, db),
      at = utc(now());
    if (flowId) {
      getFlow(flowId);
      db.prepare(
        "UPDATE flows SET name=?,description=?,trigger_type=?,trigger_keywords=?,active=?,steps_json=?,updated_at=? WHERE id=?",
      ).run(
        body.name,
        String(body.description || ""),
        body.trigger_type || "KEYWORD",
        String(body.trigger_keywords || ""),
        body.active ? 1 : 0,
        JSON.stringify(steps),
        at,
        flowId,
      );
      db.prepare("DELETE FROM lead_flow_sessions WHERE flow_id=?").run(flowId);
      db.prepare(
        "UPDATE outbound_jobs SET status='CANCELLED',error='Fluxo editado' WHERE source_id=? AND status='PENDING'",
      ).run(flowId);
    } else {
      flowId = id();
      db.prepare(
        "INSERT INTO flows(id,name,description,trigger_type,trigger_keywords,active,steps_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        flowId,
        body.name,
        String(body.description || ""),
        body.trigger_type || "KEYWORD",
        String(body.trigger_keywords || ""),
        body.active ? 1 : 0,
        JSON.stringify(steps),
        at,
        at,
      );
    }
    return flowView(getFlow(flowId));
  };
  app.post(base + "/flows", (req, res) =>
    res.status(201).json(db.transaction(() => saveFlow(req.body))()),
  );
  app.patch(base + "/flows/:id", (req, res) =>
    res.json(
      db.transaction(() =>
        saveFlow(
          { ...flowView(getFlow(req.params.id)), ...req.body },
          req.params.id,
        ),
      )(),
    ),
  );
  app.patch(base + "/flows/:id/toggle", (req, res) => {
    const f = getFlow(req.params.id);
    db.transaction(() => {
      db.prepare("UPDATE flows SET active=?,updated_at=? WHERE id=?").run(
        f.active ? 0 : 1,
        utc(now()),
        f.id,
      );
      if (f.active) {
        db.prepare("DELETE FROM lead_flow_sessions WHERE flow_id=?").run(f.id);
        db.prepare(
          "UPDATE outbound_jobs SET status='CANCELLED',error='Fluxo desativado' WHERE source_id=? AND status='PENDING'",
        ).run(f.id);
      }
    })();
    res.json(flowView(getFlow(f.id)));
  });
  app.delete(base + "/flows/:id", (req, res) => {
    getFlow(req.params.id);
    db.transaction(() => {
      db.prepare(
        "UPDATE outbound_jobs SET status='CANCELLED',error='Fluxo excluído' WHERE source_id=? AND status='PENDING'",
      ).run(req.params.id);
      db.prepare("DELETE FROM flows WHERE id=?").run(req.params.id);
    })();
    res.json({ success: true });
  });
  app.post(base + "/flows/:id/trigger-lead", (req, res) =>
    res.json(
      campaigns.once(
        "trigger-flow",
        key(req),
        { flowId: req.params.id, body: req.body },
        () => {
          flows.start(
            leads.get(req.body.leadId),
            getFlow(req.params.id),
            null,
            actor(req),
          );
          return {
            success: true,
            message:
              "Fluxo colocado na fila; ação real sujeita à política de consentimento.",
          };
        },
      ),
    ),
  );
  app.use("/api", (req, res) =>
    res
      .status(404)
      .json({ error: "Endpoint não encontrado.", code: "NOT_FOUND" }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const constraint = /UNIQUE constraint failed/.test(err.message);
    const status =
      err.status ||
      (constraint
        ? 409
        : err.code?.startsWith("SQLITE_CONSTRAINT")
          ? 400
          : 500);
    if (status === 500) console.error("Falha interna:", err.message);
    res.status(status).json({
      error:
        status === 500
          ? "Falha interna; a operação não foi confirmada."
          : constraint
            ? "Registro já existente."
            : err.message,
      code: err.code || "REQUEST_ERROR",
    });
  });
  return app;
}
module.exports = { createApp };
