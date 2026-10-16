const {
  id,
  utc,
  text,
  integer,
  fail,
  normalizePhone,
  personalize,
} = require("./domain");
const { consent, canSend } = require("./policy");
function validateFlow(body, db) {
  text(body.name, "Nome do fluxo", 200);
  if (!["KEYWORD", "ALL_NEW"].includes(body.trigger_type || "KEYWORD"))
    fail("Gatilho inválido.");
  if (
    !Array.isArray(body.steps) ||
    !body.steps.length ||
    body.steps.length > 100
  )
    fail("O fluxo deve ter entre 1 e 100 etapas.");
  const ids = new Set(body.steps.map((s) => s.id));
  if (
    ids.size !== body.steps.length ||
    body.steps.some((s) => typeof s.id !== "string")
  )
    fail("IDs de etapas inválidos ou repetidos.");
  const steps = body.steps.map((s) => {
    if (!["TEXT", "IMAGE", "VIDEO", "AUDIO"].includes(s.type))
      fail("Tipo de mídia inválido.");
    if (s.type === "AUDIO" && s.options?.length)
      fail("Use uma etapa de texto após o áudio para apresentar opções.");
    if (s.type !== "TEXT") {
      let u;
      try {
        u = new URL(s.mediaUrl);
      } catch {
        fail("URL de mídia inválida.");
      }
      const hosts = (process.env.WAPPGR_MEDIA_HOSTS || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        !hosts.includes(u.hostname)
      )
        fail("Mídia exige HTTPS e domínio autorizado em WAPPGR_MEDIA_HOSTS.");
    }
    if (s.nextStepId && !ids.has(s.nextStepId))
      fail("Destino automático inexistente.");
    const options = s.options || [];
    if (!Array.isArray(options) || options.length > 20)
      fail("Máximo de 20 opções.");
    const words = new Set();
    for (const o of options) {
      text(o.label, "Rótulo", 100);
      text(o.keyword, "Palavra da opção", 80);
      if (words.has(o.keyword.toUpperCase()))
        fail("Opções com palavras repetidas.");
      words.add(o.keyword.toUpperCase());
      if (
        ["SAIR", "PARAR", "CANCELAR", "DESCADASTRAR"].includes(
          o.keyword.toUpperCase(),
        )
      )
        fail("Palavra reservada para descadastro.");
      if (o.nextStepId && !ids.has(o.nextStepId))
        fail("Destino de opção inexistente.");
    }
    let categoryId = s.changeCategoryId || null;
    if (!categoryId && s.changeCategory)
      categoryId = db
        .prepare("SELECT id FROM categories WHERE name=?")
        .get(s.changeCategory)?.id;
    if (
      (s.changeCategory || s.changeCategoryId) &&
      (!categoryId ||
        !db.prepare("SELECT id FROM categories WHERE id=?").get(categoryId))
    )
      fail("Categoria da etapa não existe.");
    return {
      ...s,
      content: String(s.content || "").slice(0, 10000),
      options,
      delaySeconds: integer(s.delaySeconds, 1, 0, 300, "Atraso"),
      changeCategoryId: categoryId,
      changeCategory: "",
    };
  });
  const visiting = new Set(),
    visited = new Set();
  function visit(s) {
    if (visiting.has(s.id))
      fail(
        "Ciclo automático detectado. Use uma resposta interativa para retornar a uma etapa.",
      );
    if (visited.has(s.id)) return;
    visiting.add(s.id);
    if (!s.options.length && s.nextStepId)
      visit(steps.find((x) => x.id === s.nextStepId));
    visiting.delete(s.id);
    visited.add(s.id);
  }
  steps.forEach(visit);
  return steps;
}
class Flows {
  constructor(db, dispatcher, { now = Date.now } = {}) {
    this.db = db;
    this.dispatcher = dispatcher;
    this.now = now;
  }
  config() {
    return JSON.parse(
      this.db
        .prepare("SELECT value FROM settings WHERE key='optInConfig'")
        .get()?.value || "{}",
    );
  }
  receive(payload) {
    if (!payload.msgId || !payload.remoteJid) return false;
    return !!this.db
      .prepare(
        "INSERT OR IGNORE INTO inbound_events(provider_id,payload_json,created_at) VALUES(?,?,?)",
      )
      .run(
        payload.remoteJid + ":" + payload.msgId,
        JSON.stringify(payload),
        utc(this.now()),
      ).changes;
  }
  start(lead, flow, step, _actor = "system") {
    const reason = canSend(lead, "REQUESTED_FLOW", this.now());
    if (reason) fail(reason, 409);
    if (!flow.active) fail("Fluxo desativado.", 409);
    const first = step || JSON.parse(flow.steps_json)[0];
    if (!first) fail("Fluxo sem etapas.", 409);
    this.db
      .prepare(
        "UPDATE outbound_jobs SET status='CANCELLED',error='Sessão substituída' WHERE lead_id=? AND kind='REQUESTED_FLOW' AND status='PENDING'",
      )
      .run(lead.id);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO lead_flow_sessions(lead_id,lead_phone,flow_id,current_step_id,last_message_at,due_at,expires_at,status,steps_executed,job_id) VALUES(?,?,?,?,?,?,?,'READY',0,NULL)",
      )
      .run(
        lead.id,
        lead.phone,
        flow.id,
        first.id,
        utc(this.now()),
        utc(this.now() + Number(first.delaySeconds || 0) * 1000),
        utc(this.now() + 24 * 3600000),
      );
  }
  processInbound(event) {
    const payload = JSON.parse(event.payload_json),
      at = utc(this.now());
    const receivedAt = Date.parse(event.created_at);
    const clientTime = Date.parse(payload.clientTimestamp || event.created_at);
    const messageAt = utc(
      Math.min(
        this.now(),
        receivedAt,
        Number.isFinite(clientTime) ? clientTime : receivedAt,
      ),
    );
    let lead = this.db
      .prepare("SELECT * FROM leads WHERE jid=?")
      .get(payload.remoteJid);
    const phone = normalizePhone(payload.phone);
    if (!lead && phone)
      lead = this.db.prepare("SELECT * FROM leads WHERE phone=?").get(phone);
    const isNew = !lead;
    if (!lead) {
      const phoneValue = phone || "lid:" + payload.remoteJid.split("@")[0];
      const leadId = id(),
        cat = this.db
          .prepare("SELECT id FROM categories WHERE name='Leads Orgânicos'")
          .get();
      this.db
        .prepare(
          "INSERT INTO leads(id,name,phone,jid,status,category_id,created_at) VALUES(?,?,?,?,'PENDING',?,?)",
        )
        .run(
          leadId,
          payload.pushName || "Contato WhatsApp",
          phoneValue,
          payload.remoteJid,
          cat?.id || null,
          at,
        );
      lead = this.db.prepare("SELECT * FROM leads WHERE id=?").get(leadId);
    }
    const lastInboundAt =
      lead.last_inbound_at && lead.last_inbound_at > messageAt
        ? lead.last_inbound_at
        : messageAt;
    this.db
      .prepare(
        "UPDATE leads SET last_inbound_at=?,last_interaction=?,jid=? WHERE id=?",
      )
      .run(lastInboundAt, lastInboundAt, payload.remoteJid, lead.id);
    lead = { ...lead, last_inbound_at: lastInboundAt, jid: payload.remoteJid };
    this.db
      .prepare(
        "INSERT INTO messages(id,lead_id,lead_phone,lead_name,direction,text,type,whatsapp_msg_id,status,timestamp) VALUES(?,?,?,?,'INBOUND',?,'CHAT',?,'RECEIVED',?)",
      )
      .run(
        id(),
        lead.id,
        lead.phone,
        lead.name,
        payload.text,
        payload.msgId,
        messageAt,
      );
    this.db
      .prepare("UPDATE inbound_events SET lead_id=? WHERE provider_id=?")
      .run(lead.id, event.provider_id);
    const cfg = this.config(),
      word = payload.text.trim().toUpperCase();
    const no = [
      ...new Set([
        "SAIR",
        "PARAR",
        "CANCELAR",
        "DESCADASTRAR",
        ...(cfg.noKeywords || []).filter((k) => !/^\d+$/.test(k)),
      ]),
    ];
    const reply = (kind, value) => {
      if (value)
        this.dispatcher.enqueue({
          lead,
          kind,
          payload: { type: "TEXT", text: value },
          priority: 0,
          jobId: "reply:" + event.provider_id,
        });
    };
    if (no.includes(word)) {
      consent(
        this.db,
        lead.id,
        "OPT_OUT",
        { source: "WHATSAPP_KEYWORD", reason: "Pedido explícito: " + word },
        this.now(),
      );
      reply(
        "OPTOUT_CONFIRMATION",
        cfg.optOutMessage || "Descadastro confirmado.",
      );
      return;
    }
    const session = this.db
      .prepare("SELECT * FROM lead_flow_sessions WHERE lead_id=?")
      .get(lead.id);
    if (session && session.status === "WAITING_REPLY") {
      const flow = this.db
        .prepare("SELECT * FROM flows WHERE id=? AND active=1")
        .get(session.flow_id);
      if (flow) {
        const steps = JSON.parse(flow.steps_json),
          step = steps.find((s) => s.id === session.current_step_id);
        const match = step?.options?.find(
          (o) =>
            o.keyword.toUpperCase() === word || o.label.toUpperCase() === word,
        );
        if (match) {
          if (!match.nextStepId)
            this.db
              .prepare("DELETE FROM lead_flow_sessions WHERE lead_id=?")
              .run(lead.id);
          else
            this.start(
              lead,
              flow,
              steps.find((s) => s.id === match.nextStepId),
            );
          return;
        }
      }
    }
    const yes = (cfg.yesKeywords || ["SIM", "ACEITO", "AUTORIZO"])
      .filter((k) => !/^\d+$/.test(k))
      .map((k) => k.toUpperCase());
    if (yes.includes(word)) {
      // A delayed authorization must not override a more recent explicit refusal.
      if (
        lead.status === "OPT_OUT" &&
        lead.consent_timestamp &&
        messageAt < lead.consent_timestamp
      )
        return;
      consent(
        this.db,
        lead.id,
        "OPT_IN",
        {
          source: "WHATSAPP_KEYWORD",
          reason: "Autorização explícita: " + word,
          evidence: true,
          reconfirm: true,
        },
        this.now(),
      );
      reply(
        "CONSENT_REPLY",
        cfg.confirmationMessage || "Autorização registrada.",
      );
      return;
    }
    if (lead.status !== "OPT_OUT") {
      for (const flow of this.db
        .prepare("SELECT * FROM flows WHERE active=1 ORDER BY created_at,id")
        .all()) {
        const match =
          flow.trigger_type === "ALL_NEW"
            ? isNew
            : (flow.trigger_keywords || "")
                .split(",")
                .map((k) => k.trim().toUpperCase())
                .filter(Boolean)
                .some((k) => word.includes(k));
        if (match) {
          this.start(lead, flow);
          return;
        }
      }
    }
    if (isNew && cfg.autoOptInOnFirstMessage)
      reply("CONSENT_REPLY", cfg.welcomeMessage);
  }
  tick(leadId = null) {
    // All business effects are synchronous in a short transaction. Per-contact order is preserved,
    // and the provider calls happen only later in the shared dispatcher.
    const lead = leadId
      ? this.db.prepare("SELECT * FROM leads WHERE id=?").get(leadId)
      : null;
    const pending = lead
      ? this.db
          .prepare(
            `SELECT * FROM inbound_events WHERE status='PENDING' AND
      (lead_id=? OR json_extract(payload_json,'$.remoteJid')=? OR REPLACE(json_extract(payload_json,'$.phone'),'+','')=?) ORDER BY created_at,rowid`,
          )
          .all(lead.id, lead.jid, lead.phone)
      : this.db
          .prepare(
            "SELECT * FROM inbound_events WHERE status='PENDING' ORDER BY created_at,rowid LIMIT 50",
          )
          .all();
    for (const event of pending) {
      try {
        this.db.transaction(() => {
          this.processInbound(event);
          this.db
            .prepare(
              "UPDATE inbound_events SET status='PROCESSED' WHERE provider_id=? AND status='PENDING'",
            )
            .run(event.provider_id);
        })();
      } catch (e) {
        this.db
          .prepare(
            "UPDATE inbound_events SET status='ERROR',error=? WHERE provider_id=?",
          )
          .run(e.message, event.provider_id);
      }
    }
    for (const session of this.db
      .prepare("SELECT * FROM lead_flow_sessions ORDER BY last_message_at")
      .all()) {
      const flow = this.db
        .prepare("SELECT * FROM flows WHERE id=?")
        .get(session.flow_id);
      const lead = this.db
        .prepare(
          "SELECT l.*,c.name category_name FROM leads l LEFT JOIN categories c ON c.id=l.category_id WHERE l.id=?",
        )
        .get(session.lead_id);
      if (
        !flow?.active ||
        !lead ||
        lead.status === "OPT_OUT" ||
        !session.expires_at ||
        Date.parse(session.expires_at) <= this.now()
      ) {
        this.db
          .prepare(
            "UPDATE outbound_jobs SET status='CANCELLED',error='Sessão encerrada ou expirada' WHERE id=? AND status='PENDING'",
          )
          .run(session.job_id);
        this.db
          .prepare("DELETE FROM lead_flow_sessions WHERE lead_id=?")
          .run(session.lead_id);
        continue;
      }
      const steps = JSON.parse(flow.steps_json),
        step = steps.find((s) => s.id === session.current_step_id);
      if (!step) {
        this.db
          .prepare("DELETE FROM lead_flow_sessions WHERE lead_id=?")
          .run(lead.id);
        continue;
      }
      if (
        session.status === "READY" &&
        Date.parse(session.due_at) <= this.now()
      ) {
        if (session.steps_executed >= 20) {
          this.db
            .prepare(
              "UPDATE lead_flow_sessions SET status='LIMIT_REACHED' WHERE lead_id=?",
            )
            .run(lead.id);
          continue;
        }
        this.db.transaction(() => {
          const job = this.dispatcher.enqueue({
            lead,
            kind: "REQUESTED_FLOW",
            payload: {
              type: step.type,
              text: personalize(step.content || "", lead),
              mediaUrl: step.mediaUrl,
              options: step.options,
            },
            sourceId: flow.id,
            sourceVersion: flow.updated_at,
            jobId: id(),
          });
          this.db
            .prepare(
              "UPDATE lead_flow_sessions SET status='WAITING_SEND',job_id=?,steps_executed=steps_executed+1 WHERE lead_id=?",
            )
            .run(job.id, lead.id);
        })();
      } else if (session.status === "WAITING_SEND") {
        const job = this.db
          .prepare("SELECT * FROM outbound_jobs WHERE id=?")
          .get(session.job_id);
        if (["SENT", "DELIVERED", "READ"].includes(job?.status)) {
          if (
            step.type === "AUDIO" &&
            step.content &&
            JSON.parse(job.payload_json).type === "AUDIO"
          ) {
            const supplemental = this.dispatcher.enqueue({
              lead,
              kind: "REQUESTED_FLOW",
              payload: { type: "TEXT", text: personalize(step.content, lead) },
              sourceId: flow.id,
              sourceVersion: flow.updated_at,
              jobId: job.id + ":text",
            });
            this.db
              .prepare("UPDATE lead_flow_sessions SET job_id=? WHERE lead_id=?")
              .run(supplemental.id, lead.id);
            continue;
          }
          this.db.transaction(() => {
            const catId =
              step.changeCategoryId ||
              (step.changeCategory
                ? this.db
                    .prepare("SELECT id FROM categories WHERE name=?")
                    .get(step.changeCategory)?.id
                : null);
            if (
              catId &&
              this.db.prepare("SELECT id FROM categories WHERE id=?").get(catId)
            )
              this.db
                .prepare("UPDATE leads SET category_id=? WHERE id=?")
                .run(catId, lead.id);
            if (step.options?.length)
              this.db
                .prepare(
                  "UPDATE lead_flow_sessions SET status='WAITING_REPLY',job_id=NULL WHERE lead_id=?",
                )
                .run(lead.id);
            else if (
              step.nextStepId &&
              steps.some((s) => s.id === step.nextStepId)
            ) {
              const next = steps.find((s) => s.id === step.nextStepId);
              this.db
                .prepare(
                  "UPDATE lead_flow_sessions SET status='READY',current_step_id=?,due_at=?,job_id=NULL WHERE lead_id=?",
                )
                .run(
                  next.id,
                  utc(this.now() + Number(next.delaySeconds || 0) * 1000),
                  lead.id,
                );
            } else
              this.db
                .prepare("DELETE FROM lead_flow_sessions WHERE lead_id=?")
                .run(lead.id);
          })();
        } else if (job && !["PENDING", "SENDING"].includes(job.status))
          this.db
            .prepare(
              "UPDATE lead_flow_sessions SET status='SEND_ERROR' WHERE lead_id=?",
            )
            .run(lead.id);
      }
    }
  }
}
module.exports = { Flows, validateFlow };
