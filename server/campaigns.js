const {
  id,
  utc,
  fail,
  text,
  integer,
  hash,
  zone,
  page,
  csv,
  validDestination,
  personalize,
  validateSelection,
} = require("./domain");
const { toUtc } = require("./time");
const official = require("./official-policy");
const TERMINAL = [
  "COMPLETED",
  "COMPLETED_WITH_FAILURES",
  "CANCELLED",
  "LEGACY",
];
const ACTIVE = [
  "SCHEDULED",
  "RUNNING",
  "WAITING_INTERVAL",
  "WAITING_CONNECTION",
];
const WORK = ["PENDING", "RETRY_WAIT", "RESERVED", "SENDING"];

class Campaigns {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
  }
  event(campaignId, kind, details, actor = "system") {
    this.db
      .prepare(
        "INSERT INTO campaign_events(campaign_id,kind,details,actor,created_at) VALUES(?,?,?,?,?)",
      )
      .run(campaignId, kind, JSON.stringify(details), actor, utc(this.now()));
  }
  once(scope, key, body, fn) {
    text(key, "Chave de idempotência", 200);
    return this.db.transaction(() => {
      const fingerprint = hash(body);
      const previous = this.db
        .prepare("SELECT * FROM idempotency_keys WHERE scope=? AND key=?")
        .get(scope, key);
      if (previous) {
        if (previous.request_hash !== fingerprint)
          fail(
            "Chave de idempotência já usada com outro conteúdo.",
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        return JSON.parse(previous.response_json);
      }
      const response = fn();
      this.db
        .prepare("INSERT INTO idempotency_keys VALUES(?,?,?,?,?)")
        .run(
          scope,
          key,
          fingerprint,
          JSON.stringify(response),
          utc(this.now()),
        );
      return response;
    })();
  }
  audience(selection = {}, messageCategory = null) {
    validateSelection(selection);
    const excluded = new Set(selection.excludedIds || []);
    if (excluded.size > 100000) fail("Muitas exclusões.");
    let rows,
      missing = 0;
    if (selection.type === "ids") {
      if (!Array.isArray(selection.ids) || selection.ids.length > 100000)
        fail("Seleção de IDs inválida.");
      const ids = [...new Set(selection.ids)];
      if (ids.some((x) => typeof x !== "string")) fail("IDs inválidos.");
      const query = this.db.prepare(
        "SELECT l.*,c.name category_name FROM leads l LEFT JOIN categories c ON c.id=l.category_id WHERE l.id=?",
      );
      rows = ids.map((x) => query.get(x)).filter(Boolean);
      missing = ids.length - rows.length;
    } else {
      const filters = selection.filters || {};
      const where = [],
        params = [];
      if (filters.categoryId) {
        where.push("l.category_id=?");
        params.push(filters.categoryId);
      } else if (filters.category && filters.category !== "TODOS") {
        where.push("c.name=?");
        params.push(filters.category);
      }
      if (filters.status && filters.status !== "TODOS") {
        if (!["OPT_IN", "OPT_OUT", "PENDING"].includes(filters.status))
          fail("Filtro de status inválido.");
        where.push("l.status=?");
        params.push(filters.status);
      }
      if (filters.search) {
        const q = "%" + text(filters.search, "Busca", 200) + "%";
        where.push("(l.name LIKE ? OR l.phone LIKE ? OR l.notes LIKE ?)");
        params.push(q, q, q);
      }
      rows = this.db
        .prepare(
          "SELECT l.*,c.name category_name FROM leads l LEFT JOIN categories c ON c.id=l.category_id" +
            (where.length ? " WHERE " + where.join(" AND ") : "") +
            " ORDER BY l.created_at,l.id",
        )
        .all(...params);
      if (rows.length > 100000)
        fail("Máximo de 100.000 contatos por campanha.");
    }
    rows.sort(
      (a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)) ||
        a.id.localeCompare(b.id),
    );
    const reasons = {
      excludedByOperator: 0,
      notOptedIn: 0,
      invalidIdentity: 0,
      duplicate: 0,
      missing,
      outsideWindow: 0,
      optedOut: 0,
    };
    const phones = new Set(),
      eligible = [];
    for (const lead of rows) {
      if (excluded.has(lead.id)) {
        reasons.excludedByOperator++;
        continue;
      }
      const denied = messageCategory
        ? official.eligibility(lead, messageCategory, this.now())
        : null;
      if (denied || (!messageCategory && lead.status !== "OPT_IN")) {
        if (denied?.code === "WINDOW_EXPIRED") reasons.outsideWindow++;
        else if (denied?.code === "OPT_OUT") reasons.optedOut++;
        else reasons.notOptedIn++;
        continue;
      }
      if (!validDestination(lead)) {
        reasons.invalidIdentity++;
        continue;
      }
      if (phones.has(lead.phone)) {
        reasons.duplicate++;
        continue;
      }
      phones.add(lead.phone);
      eligible.push(lead);
    }
    return {
      rows: eligible,
      summary: {
        selected: rows.length + missing,
        eligible: eligible.length,
        excluded: rows.length + missing - eligible.length,
        reasons,
      },
    };
  }
  preview(input) {
    const config = official.validateMessage(this.db, input, {
      required: false,
      now: this.now(),
    });
    const audience = this.audience(
      input.selection || {
        type: "filters",
        filters: { categoryId: input.categoryId },
      },
      config.messageCategory,
    );
    const cost = official.estimate(this.db, config, audience.rows, this.now());
    return {
      ...audience.summary,
      messageCategory: config.messageCategory,
      cost,
      budgetReason: official.budgetReason(config, cost),
      previewToken: hash({
        config,
        ids: audience.rows.map((l) => l.id),
        summary: audience.summary,
        rate: cost.rateVersion || null,
      }),
    };
  }
  assertExecutable(c) {
    if (c.review_required)
      fail(
        "Revise categoria, modelo e prévia antes de reativar o registro antigo.",
        409,
        "REVIEW_REQUIRED",
      );
    const config = official.validateMessage(this.db, c.messageConfig, {
      now: this.now(),
    });
    if (config.maxBudget === undefined) return config;
    const reason = official.budgetReason(config, this.cost(c));
    if (reason) fail(reason, 409, reason.split(":")[0]);
    return config;
  }
  cost(c) {
    const rows = this.db
      .prepare(
        "SELECT l.*,r.phone_snapshot phone FROM campaign_recipients r LEFT JOIN leads l ON l.id=r.lead_id WHERE r.campaign_id=? AND r.status IN ('PENDING','RESERVED','RETRY_WAIT')",
      )
      .all(c.id);
    const cost = official.estimate(this.db, c.messageConfig, rows, this.now());
    if (!cost.available) return cost;
    let reserved = 0;
    for (const m of this.db
      .prepare(
        "SELECT estimate_json FROM messages WHERE campaign_id=? AND provider='CLOUD_API' AND status IN ('SENDING','SENT','DELIVERED','READ','UNCERTAIN')",
      )
      .all(c.id)) {
      const estimate = JSON.parse(m.estimate_json || "null");
      if (!estimate?.available || estimate.currency !== cost.currency)
        return {
          ...cost,
          available: false,
          total: null,
          reason:
            "Há mensagens aceitas ou incertas sem estimativa compatível. Reconcilie antes de aumentar a exposição.",
        };
      reserved += estimate.total;
    }
    return {
      ...cost,
      reserved,
      total: Math.round((cost.total + reserved) * 1e6) / 1e6,
    };
  }
  edit(campaignId, input, actor = "admin") {
    return this.db.transaction(() => {
      const old = this.get(campaignId);
      if (
        old.inFlight ||
        old.cancel_requested ||
        (!old.manual_paused &&
          !["DRAFT", "REVIEW_REQUIRED"].includes(old.execution_status)) ||
        TERMINAL.includes(old.execution_status)
      )
        fail("Edite um rascunho ou pause a campanha antes de revisar.", 409);
      const merged = {
        ...old.config,
        ...old.messageConfig,
        title: old.title,
        message: old.message,
        ...input,
      };
      const config = official.validateMessage(this.db, merged, {
        required: old.execution_status !== "DRAFT",
        now: this.now(),
      });
      const selection = JSON.parse(old.selection_json).selection || {
        type: "ids",
        ids: this.db
          .prepare(
            "SELECT lead_id FROM campaign_recipients WHERE campaign_id=?",
          )
          .all(campaignId)
          .map((r) => r.lead_id),
      };
      if (
        old.review_required &&
        (input.reviewed !== true ||
          input.previewToken !==
            this.preview({ ...merged, selection }).previewToken)
      )
        fail(
          "Confirme a revisão após gerar uma prévia atual de elegibilidade.",
          409,
          "REVIEW_REQUIRED",
        );
      official.history(
        this.db,
        "campaigns",
        campaignId,
        old,
        actor,
        this.now(),
      );
      const message =
        config.messageCategory === "SERVICE"
          ? String(merged.message || "")
          : String(merged.message || "");
      this.db
        .prepare(
          "UPDATE campaigns SET title=?,message=?,message_category=?,message_config_json=?,review_required=0,reviewed_at=?,reason=NULL WHERE id=?",
        )
        .run(
          text(merged.title, "Título", 200),
          message,
          config.messageCategory,
          JSON.stringify(config),
          utc(this.now()),
          campaignId,
        );
      for (const r of this.db
        .prepare(
          "SELECT l.*,c.name category_name FROM campaign_recipients r JOIN leads l ON l.id=r.lead_id LEFT JOIN categories c ON c.id=l.category_id WHERE r.campaign_id=? AND r.status IN ('PENDING','RETRY_WAIT')",
        )
        .all(campaignId)) {
        // The audience, batches and all attempted messages remain frozen.
        this.db
          .prepare(
            "UPDATE campaign_recipients SET message_snapshot=? WHERE campaign_id=? AND lead_id=? AND status IN ('PENDING','RETRY_WAIT')",
          )
          .run(personalize(message, r), campaignId, r.id);
      }
      if (old.execution_status === "REVIEW_REQUIRED")
        this.setState(
          campaignId,
          "PAUSED",
          "Revisão concluída; continue explicitamente.",
        );
      this.event(
        campaignId,
        "CONFIGURATION_REVIEWED",
        { messageConfig: config },
        actor,
      );
      return this.get(campaignId);
    })();
  }
  config(input = {}) {
    const timezone = zone(input.timezone || "America/Sao_Paulo");
    const mode = input.mode || "AUTO";
    if (!["AUTO", "MANUAL"].includes(mode)) fail("Modo inválido.");
    const startMode = input.startMode || "IMMEDIATE";
    if (!["IMMEDIATE", "SCHEDULED", "DRAFT"].includes(startMode))
      fail("Início inválido.");
    let startAt = utc(this.now());
    if (startMode === "SCHEDULED") {
      startAt = input.startLocal
        ? toUtc(input.startLocal, timezone)
        : input.startAt;
      if (
        !startAt ||
        !/Z$/.test(startAt) ||
        !Number.isFinite(Date.parse(startAt)) ||
        Date.parse(startAt) < this.now()
      )
        fail("Início deve ser uma data futura válida.");
      startAt = utc(startAt);
    }
    return {
      batchSize: integer(input.batchSize, 40, 1, 200, "Tentativas por lote"),
      batchIntervalSeconds: integer(
        input.batchIntervalSeconds,
        7200,
        60,
        604800,
        "Intervalo entre lotes",
      ),
      pacingSeconds: integer(
        input.pacingSeconds,
        10,
        1,
        300,
        "Intervalo entre mensagens",
      ),
      maxAttempts: integer(input.maxAttempts, 3, 1, 5, "Máximo de tentativas"),
      mode,
      timezone,
      startMode,
      startAt,
    };
  }
  create(input, key, actor = "admin") {
    return this.once("create-campaign", key, input, () => {
      const title = text(input.title, "Título", 200);
      const config = this.config(input);
      const messageConfig = official.validateMessage(this.db, input, {
        required: config.startMode !== "DRAFT",
        now: this.now(),
      });
      const message =
        messageConfig.messageCategory === "SERVICE" &&
        config.startMode !== "DRAFT" &&
        (messageConfig.type || "TEXT") === "TEXT"
          ? text(input.message, "Mensagem", 4096)
          : String(input.message || "").slice(0, 4096);
      const selection = input.selection || {
        type: "filters",
        filters: { category: input.categoryFilter },
      };
      const audience = this.audience(selection, messageConfig.messageCategory);
      if (!audience.rows.length && config.startMode !== "DRAFT")
        fail("Nenhum destinatário elegível.", 400, "NO_AUDIENCE");
      const campaignId = id(),
        at = utc(this.now());
      const state = config.startMode === "DRAFT" ? "DRAFT" : "SCHEDULED";
      this.db
        .prepare(
          "INSERT INTO campaigns(id,title,message,category_filter,total_target,pacing_seconds,status,execution_status,config_json,selection_json,next_run_at,schedule_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'PENDING',?,?,?,?,?,?,?)",
        )
        .run(
          campaignId,
          title,
          message,
          input.categoryFilter || "SELECAO",
          audience.rows.length,
          config.pacingSeconds,
          state,
          JSON.stringify(config),
          JSON.stringify({ selection, preview: audience.summary }),
          config.startAt,
          input.scheduleId || null,
          at,
          at,
        );
      this.db
        .prepare(
          "UPDATE campaigns SET message_category=?,message_config_json=? WHERE id=?",
        )
        .run(
          messageConfig.messageCategory,
          JSON.stringify(messageConfig),
          campaignId,
        );
      const budget = official.budgetReason(
        messageConfig,
        official.estimate(this.db, messageConfig, audience.rows, this.now()),
      );
      if (budget && state !== "DRAFT")
        this.db
          .prepare(
            "UPDATE campaigns SET manual_paused=1,execution_status='BUDGET_SUSPENDED',reason=? WHERE id=?",
          )
          .run(budget, campaignId);
      const restriction = this.db
        .prepare("SELECT * FROM account_control WHERE id=1")
        .get();
      if (restriction.restricted && state !== "DRAFT") {
        this.db
          .prepare(
            "UPDATE campaigns SET execution_status='ACCOUNT_RESTRICTED',manual_paused=1,reason=? WHERE id=?",
          )
          .run(restriction.reason, campaignId);
      }
      const insert = this.db.prepare(
        "INSERT INTO campaign_recipients(id,campaign_id,lead_id,position,phone_snapshot,jid_snapshot,name_snapshot,category_snapshot,message_snapshot,updated_at,retry_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      );
      audience.rows.forEach((lead, i) =>
        insert.run(
          id(),
          campaignId,
          lead.id,
          i + 1,
          lead.phone,
          lead.jid || null,
          lead.name,
          lead.category_name || "",
          personalize(message, lead),
          at,
          config.maxAttempts,
        ),
      );
      this.event(
        campaignId,
        "CREATED",
        { audience: audience.summary, config },
        actor,
      );
      return {
        campaign: this.get(campaignId),
        message: "Campanha persistida. A lista de destinatários foi congelada.",
      };
    });
  }
  get(campaignId) {
    const c = this.db
      .prepare("SELECT * FROM campaigns WHERE id=?")
      .get(campaignId);
    if (!c) fail("Campanha não encontrada.", 404);
    const counts = Object.fromEntries(
      this.db
        .prepare(
          "SELECT status,COUNT(*) count FROM campaign_recipients WHERE campaign_id=? GROUP BY status",
        )
        .all(campaignId)
        .map((x) => [x.status, x.count]),
    );
    const attempts = this.db
      .prepare(
        "SELECT COALESCE(SUM(attempts),0) n FROM campaign_recipients WHERE campaign_id=?",
      )
      .get(campaignId).n;
    const batch =
      this.db
        .prepare(
          "SELECT * FROM campaign_batches WHERE campaign_id=? ORDER BY number DESC LIMIT 1",
        )
        .get(campaignId) || null;
    const config = JSON.parse(c.config_json);
    const inFlight = this.db
      .prepare(
        "SELECT COUNT(*) n FROM send_attempts a JOIN campaign_recipients r ON r.id=a.recipient_id WHERE r.campaign_id=? AND a.status='STARTED'",
      )
      .get(campaignId).n;
    return {
      ...c,
      config,
      messageConfig: JSON.parse(c.message_config_json),
      counts,
      attempts,
      inFlight,
      batch,
      preview: JSON.parse(c.selection_json).preview,
      sent: (counts.SENT || 0) + (counts.DELIVERED || 0) + (counts.READ || 0),
      delivered: (counts.DELIVERED || 0) + (counts.READ || 0),
      read: counts.READ || 0,
      pending: WORK.reduce((n, s) => n + (counts[s] || 0), 0),
      serverNow: utc(this.now()),
      legacy: c.execution_status === "LEGACY",
    };
  }
  list() {
    return this.db
      .prepare("SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 200")
      .all()
      .map((c) => this.get(c.id));
  }
  setState(campaignId, state, reason = null, extra = {}) {
    this.db
      .prepare(
        "UPDATE campaigns SET execution_status=?,reason=?,updated_at=?,version=version+1 WHERE id=?",
      )
      .run(state, reason, utc(this.now()), campaignId);
    this.event(campaignId, "STATE", { state, reason, ...extra });
  }
  control(campaignId, action, body, key, actor) {
    return this.once("control:" + campaignId, key, { action, body }, () => {
      const c = this.get(campaignId);
      if (["resume", "start", "authorize-next", "retry"].includes(action))
        this.assertExecutable(c);
      if (
        ["resume", "start", "authorize-next", "retry"].includes(action) &&
        this.db
          .prepare("SELECT restricted FROM account_control WHERE id=1")
          .get().restricted
      )
        fail(
          "Conta sob restrição. É necessária revisão operacional antes de continuar.",
          409,
          "ACCOUNT_RESTRICTED",
        );
      const sending = c.inFlight > 0;
      if (c.legacy)
        fail(
          "Campanha legada não tem destinatários individuais e não pode ser retomada.",
          409,
        );
      const at = utc(this.now());
      if (action === "pause") {
        if (c.manual_paused) return c;
        if (
          TERMINAL.includes(c.execution_status) ||
          c.execution_status === "DRAFT"
        )
          fail("Não é possível pausar neste estado.", 409);
        this.db
          .prepare("UPDATE campaigns SET manual_paused=1 WHERE id=?")
          .run(campaignId);
        this.setState(
          campaignId,
          sending ? "PAUSE_REQUESTED" : "PAUSED",
          "Pausa solicitada pelo operador",
        );
      } else if (action === "resume") {
        if (!c.manual_paused) {
          if (
            ACTIVE.includes(c.execution_status) ||
            c.execution_status === "WAITING_MANUAL"
          )
            return c;
          fail("Campanha não está pausada.", 409);
        }
        if (c.cancel_requested) fail("Campanha cancelada.", 409);
        this.db
          .prepare("UPDATE campaigns SET manual_paused=0 WHERE id=?")
          .run(campaignId);
        this.setState(
          campaignId,
          c.awaiting_authorization
            ? "WAITING_MANUAL"
            : Date.parse(c.next_run_at) > this.now()
              ? "WAITING_INTERVAL"
              : "RUNNING",
        );
      } else if (action === "start") {
        if (c.execution_status !== "DRAFT") {
          if (ACTIVE.includes(c.execution_status)) return c;
          fail("Campanha não é rascunho.", 409);
        }
        this.setState(campaignId, "SCHEDULED");
      } else if (action === "authorize-next") {
        if (c.manual_paused || c.cancel_requested)
          fail("Continue a campanha antes de autorizar o lote.", 409);
        if (!c.awaiting_authorization)
          fail("Não existe próximo lote aguardando autorização.", 409);
        this.db
          .prepare("UPDATE campaigns SET awaiting_authorization=0 WHERE id=?")
          .run(campaignId);
        this.setState(
          campaignId,
          Date.parse(c.next_run_at) > this.now()
            ? "WAITING_INTERVAL"
            : "RUNNING",
          "Lote autorizado; horário mínimo preservado",
        );
      } else if (action === "cancel") {
        if (c.execution_status === "CANCELLED" || c.cancel_requested) return c;
        if (
          ["COMPLETED", "COMPLETED_WITH_FAILURES"].includes(c.execution_status)
        )
          fail("Campanha já finalizada.", 409);
        this.db
          .prepare("UPDATE campaigns SET cancel_requested=1 WHERE id=?")
          .run(campaignId);
        this.db
          .prepare(
            "UPDATE campaign_recipients SET status='CANCELLED',updated_at=?,owner=NULL,claim_token=NULL WHERE campaign_id=? AND status IN ('PENDING','RETRY_WAIT','RESERVED')",
          )
          .run(at, campaignId);
        this.setState(
          campaignId,
          sending ? "CANCEL_REQUESTED" : "CANCELLED",
          "Cancelamento solicitado pelo operador",
        );
      } else if (action === "retry") {
        if (
          c.cancel_requested ||
          c.manual_paused ||
          ![
            "COMPLETED_WITH_FAILURES",
            "RUNNING",
            "WAITING_INTERVAL",
            "WAITING_MANUAL",
          ].includes(c.execution_status)
        )
          fail("Retry indisponível neste estado.", 409);
        if (
          !Array.isArray(body.recipientIds) ||
          !body.recipientIds.length ||
          body.recipientIds.length > 1000
        )
          fail("Selecione até 1.000 falhas transitórias.");
        let changed = 0;
        for (const rid of new Set(body.recipientIds)) {
          const r = this.db
            .prepare(
              "SELECT * FROM campaign_recipients WHERE id=? AND campaign_id=?",
            )
            .get(rid, campaignId);
          if (!r || r.status !== "FAILED" || !r.retryable || r.attempts >= 5)
            fail("Destinatário não elegível para retry: " + rid, 409);
          const lead = this.db
            .prepare("SELECT * FROM leads WHERE id=?")
            .get(r.lead_id);
          if (
            !lead ||
            lead.status !== "OPT_IN" ||
            lead.phone !== r.phone_snapshot ||
            (r.jid_snapshot && lead.jid !== r.jid_snapshot)
          )
            fail("Contato alterado ou sem consentimento.", 409);
          changed += this.db
            .prepare(
              "UPDATE campaign_recipients SET status='RETRY_WAIT',next_attempt_at=?,updated_at=?,retry_limit=attempts+1 WHERE id=?",
            )
            .run(at, at, rid).changes;
        }
        if (c.batch?.status === "FINISHED" && !c.next_run_at) {
          const next = utc(
            Date.parse(c.batch.finished_at) +
              c.config.batchIntervalSeconds * 1000,
          );
          this.db
            .prepare(
              "UPDATE campaigns SET next_run_at=?,awaiting_authorization=? WHERE id=?",
            )
            .run(next, c.config.mode === "MANUAL" ? 1 : 0, campaignId);
          c.next_run_at = next;
          c.awaiting_authorization = c.config.mode === "MANUAL" ? 1 : 0;
        }
        this.setState(
          campaignId,
          c.awaiting_authorization
            ? "WAITING_MANUAL"
            : Date.parse(c.next_run_at) > this.now()
              ? "WAITING_INTERVAL"
              : "RUNNING",
        );
        this.event(campaignId, "SELECTIVE_RETRY", { count: changed }, actor);
      } else fail("Ação desconhecida.", 404);
      this.event(campaignId, "CONTROL", { action }, actor);
      return this.get(campaignId);
    });
  }
  recipients(campaignId, query = {}) {
    this.get(campaignId);
    const { page: p, limit } = page(query),
      params = [campaignId];
    let where = "campaign_id=?";
    if (query.status) {
      where += " AND status=?";
      params.push(query.status);
    }
    const total = this.db
      .prepare("SELECT COUNT(*) n FROM campaign_recipients WHERE " + where)
      .get(...params).n;
    const rows = this.db
      .prepare(
        "SELECT * FROM campaign_recipients WHERE " +
          where +
          " ORDER BY position LIMIT ? OFFSET ?",
      )
      .all(...params, limit, (p - 1) * limit);
    return {
      rows,
      pagination: {
        page: p,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  export(campaignId) {
    this.get(campaignId);
    return csv(
      this.db
        .prepare(
          "SELECT * FROM campaign_recipients WHERE campaign_id=? ORDER BY position",
        )
        .all(campaignId),
      [
        "position",
        "name_snapshot",
        "phone_snapshot",
        "status",
        "attempts",
        "error",
        "provider_id",
        "sent_at",
      ].map((key) => ({ key, label: key })),
    );
  }
}
module.exports = { Campaigns, TERMINAL, ACTIVE, WORK };
