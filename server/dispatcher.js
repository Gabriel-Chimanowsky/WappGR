const { id, utc } = require("./domain");
const { canSend } = require("./policy");
const { ACTIVE } = require("./campaigns");
const official = require("./official-policy");

class Dispatcher {
  constructor(
    db,
    campaigns,
    provider,
    { now = Date.now, minSpacingMs = 2000, owner = id() } = {},
  ) {
    this.db = db;
    this.campaigns = campaigns;
    this.provider = provider;
    this.now = now;
    this.minSpacingMs = minSpacingMs;
    this.owner = owner;
    this.busy = false;
    this.interactiveStreak = 0;
    this.timer = null;
  }
  recover() {
    const at = utc(this.now());
    this.db.transaction(() => {
      const interrupted = this.db
        .prepare(
          "SELECT DISTINCT r.campaign_id FROM send_attempts a JOIN campaign_recipients r ON r.id=a.recipient_id WHERE a.status='STARTED'",
        )
        .all();
      const interruptedJob = this.db
        .prepare("SELECT id FROM outbound_jobs WHERE status='SENDING' LIMIT 1")
        .get();
      if (interrupted.length || interruptedJob)
        this.holdCadence(
          Math.max(
            this.minSpacingMs,
            ...interrupted.map(
              (r) =>
                this.campaigns.get(r.campaign_id).config.pacingSeconds * 1000,
            ),
          ),
        );
      this.db
        .prepare(
          "UPDATE campaign_recipients SET status='UNCERTAIN',error='Processo interrompido durante envio; não será reenviado automaticamente',updated_at=? WHERE status='SENDING'",
        )
        .run(at);
      this.db
        .prepare(
          "UPDATE campaign_recipients SET status='PENDING',owner=NULL,claim_token=NULL WHERE status='RESERVED'",
        )
        .run();
      this.db
        .prepare(
          "UPDATE send_attempts SET status=COALESCE((SELECT CASE WHEN r.status IN ('SENT','DELIVERED','READ') THEN r.status ELSE 'UNCERTAIN' END FROM campaign_recipients r WHERE r.id=recipient_id),'UNCERTAIN'),finished_at=?,error='Reinício durante chamada' WHERE status='STARTED'",
        )
        .run(at);
      this.db
        .prepare(
          "UPDATE outbound_jobs SET status='UNCERTAIN',error='Reinício durante chamada',updated_at=? WHERE status='SENDING'",
        )
        .run(at);
      this.db
        .prepare(
          "UPDATE messages SET status='UNCERTAIN',error='Reinício durante chamada' WHERE status='SENDING'",
        )
        .run();
      this.db
        .prepare(
          "UPDATE campaigns SET execution_status='PAUSED' WHERE manual_paused=1 AND review_required=0 AND execution_status NOT IN ('CANCELLED','BUDGET_SUSPENDED') AND cancel_requested=0",
        )
        .run();
      this.db
        .prepare(
          "UPDATE campaigns SET execution_status='CANCELLED' WHERE cancel_requested=1",
        )
        .run();
      this.db
        .prepare(
          "UPDATE campaign_recipients SET status='CANCELLED' WHERE campaign_id IN (SELECT id FROM campaigns WHERE cancel_requested=1) AND status IN ('PENDING','RETRY_WAIT','RESERVED')",
        )
        .run();
      for (const c of this.db
        .prepare(
          "SELECT id FROM campaigns WHERE execution_status NOT IN ('LEGACY','CANCELLED','COMPLETED','COMPLETED_WITH_FAILURES','DRAFT')",
        )
        .all()) {
        this.campaigns.event(c.id, "RECOVERY", {
          message: "Progresso recuperado; envios interrompidos ficam incertos.",
        });
        this.finishOrWait(c.id);
      }
    })();
  }
  connected() {
    return this.provider.getStatus().status === "CONNECTED";
  }
  holdCadence(spacingMs) {
    // Reserve before network I/O as well as after completion. Recovery waits a
    // full spacing interval because the interrupted call's completion is unknown.
    this.db
      .prepare(
        "UPDATE session_dispatch SET next_send_at=MAX(COALESCE(next_send_at,''),?) WHERE id=1",
      )
      .run(utc(this.now() + spacingMs));
  }
  accountStatus() {
    return this.db.prepare("SELECT * FROM account_control WHERE id=1").get();
  }
  restrictAccount(reason, notBefore = null, actor = "provider") {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE account_control SET restricted=1,reason=?,not_before=COALESCE(?,not_before),updated_at=? WHERE id=1",
        )
        .run(reason, notBefore, utc(this.now()));
      this.db
        .prepare("INSERT INTO account_events VALUES(?,?,?,?,?)")
        .run(id(), "RESTRICT", reason, actor, utc(this.now()));
      for (const c of this.db
        .prepare(
          "SELECT id FROM campaigns WHERE execution_status NOT IN ('LEGACY','COMPLETED','COMPLETED_WITH_FAILURES','CANCELLED','DRAFT')",
        )
        .all()) {
        this.db
          .prepare("UPDATE campaigns SET manual_paused=1 WHERE id=?")
          .run(c.id);
        this.campaigns.setState(c.id, "ACCOUNT_RESTRICTED", reason);
      }
    })();
  }
  releaseAccount(reason, actor) {
    const control = this.accountStatus();
    if (control.not_before && Date.parse(control.not_before) > this.now())
      require("./domain").fail(
        "Prazo mínimo da restrição ainda não terminou. Aguardar não dispensa revisão.",
        409,
      );
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE account_control SET restricted=0,reason=?,not_before=NULL,updated_at=? WHERE id=1",
        )
        .run(reason, utc(this.now()));
      this.db
        .prepare("INSERT INTO account_events VALUES(?,?,?,?,?)")
        .run(id(), "REVIEW_RELEASE", reason, actor, utc(this.now()));
      for (const c of this.db
        .prepare(
          "SELECT id FROM campaigns WHERE execution_status='ACCOUNT_RESTRICTED'",
        )
        .all())
        this.campaigns.setState(
          c.id,
          this.campaigns.get(c.id).inFlight > 0 ? "PAUSE_REQUESTED" : "PAUSED",
          "Restrição revisada; continue cada campanha explicitamente",
        );
    })();
  }
  enqueue({
    lead,
    kind,
    payload,
    priority = 1,
    sourceId = null,
    sourceVersion = null,
    dueAt = null,
    actor = "system",
    jobId = id(),
    messageConfig,
  }) {
    messageConfig = official.validateMessage(
      this.db,
      messageConfig ||
        (["HUMAN_REPLY", "CONSENT_REPLY", "OPTOUT_CONFIRMATION"].includes(kind)
          ? {
              messageCategory: "SERVICE",
              type: payload.type || "TEXT",
              mediaUrl: payload.mediaUrl,
            }
          : {}),
      { now: this.now() },
    );
    const at = utc(this.now());
    this.db
      .prepare(
        "INSERT OR IGNORE INTO outbound_jobs(id,lead_id,kind,payload_json,phone_snapshot,jid_snapshot,priority,due_at,created_at,updated_at,source_id,source_version,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        jobId,
        lead.id,
        kind,
        JSON.stringify(payload),
        lead.phone,
        lead.jid || null,
        priority,
        dueAt || at,
        at,
        at,
        sourceId,
        sourceVersion,
        actor,
      );
    this.db
      .prepare(
        "UPDATE outbound_jobs SET intended_category=?,approved_category=?,sent_format=?,configuration_json=? WHERE id=? AND status='PENDING'",
      )
      .run(
        messageConfig.messageCategory,
        messageConfig.template?.approvedCategory || null,
        messageConfig.template ? "TEMPLATE" : "FREE_FORM",
        JSON.stringify(messageConfig),
        jobId,
      );
    return this.db.prepare("SELECT * FROM outbound_jobs WHERE id=?").get(jobId);
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.tick().catch((e) => console.error("Dispatcher:", e.message)),
      250,
    );
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  finishOrWait(campaignId) {
    const c = this.campaigns.get(campaignId),
      at = utc(this.now());
    if (c.legacy || c.execution_status === "DRAFT") return;
    if (
      c.review_required ||
      ["REVIEW_REQUIRED", "BUDGET_SUSPENDED"].includes(c.execution_status)
    )
      return;
    if (c.inFlight > 0) return;
    if (c.cancel_requested) {
      if (!(c.counts.SENDING || 0) && c.execution_status !== "CANCELLED")
        this.campaigns.setState(campaignId, "CANCELLED");
      return;
    }
    if (this.accountStatus().restricted && c.pending > 0) {
      if (c.execution_status !== "ACCOUNT_RESTRICTED")
        this.campaigns.setState(
          c.id,
          "ACCOUNT_RESTRICTED",
          this.accountStatus().reason,
        );
      return;
    }
    if (c.pending === 0) {
      if (c.batch?.status === "OPEN")
        this.db
          .prepare(
            "UPDATE campaign_batches SET status='FINISHED',finished_at=? WHERE id=?",
          )
          .run(at, c.batch.id);
      const state =
        (c.counts.FAILED || 0) + (c.counts.UNCERTAIN || 0) > 0
          ? "COMPLETED_WITH_FAILURES"
          : "COMPLETED";
      this.db
        .prepare(
          "UPDATE campaigns SET next_run_at=NULL,awaiting_authorization=0,manual_paused=0,sent_count=?,delivered_count=?,failed_count=?,status=?,sent_at=? WHERE id=?",
        )
        .run(
          c.sent,
          c.delivered,
          c.counts.FAILED || 0,
          "COMPLETED",
          at,
          campaignId,
        );
      if (c.execution_status !== state)
        this.campaigns.setState(campaignId, state);
      return;
    }
    if (
      c.batch?.status === "OPEN" &&
      c.batch.attempts >= c.batch.attempt_limit &&
      !(c.counts.SENDING || 0)
    ) {
      const next = utc(this.now() + c.config.batchIntervalSeconds * 1000);
      this.db
        .prepare(
          "UPDATE campaign_batches SET status='FINISHED',finished_at=?,next_run_at=? WHERE id=?",
        )
        .run(at, next, c.batch.id);
      this.db
        .prepare(
          "UPDATE campaigns SET next_run_at=?,awaiting_authorization=? WHERE id=?",
        )
        .run(next, c.config.mode === "MANUAL" ? 1 : 0, campaignId);
      this.campaigns.event(campaignId, "BATCH_FINISHED", {
        number: c.batch.number,
        attempts: c.batch.attempts,
        nextRunAt: next,
      });
    }
    const latest = this.campaigns.get(campaignId);
    if (latest.manual_paused) {
      if (!(latest.counts.SENDING || 0) && latest.execution_status !== "PAUSED")
        this.campaigns.setState(campaignId, "PAUSED");
    } else if (latest.awaiting_authorization) {
      if (latest.execution_status !== "WAITING_MANUAL")
        this.campaigns.setState(
          campaignId,
          "WAITING_MANUAL",
          "Aguardando autorização do próximo lote",
        );
    } else if (
      Date.parse(latest.next_run_at) > this.now() &&
      latest.execution_status !== "WAITING_INTERVAL"
    ) {
      this.campaigns.setState(
        campaignId,
        "WAITING_INTERVAL",
        "Intervalo persistido",
      );
    }
  }
  candidate() {
    const now = utc(this.now());
    const campaigns = this.db
      .prepare(
        "SELECT id FROM campaigns WHERE manual_paused=0 AND cancel_requested=0 AND awaiting_authorization=0 AND execution_status IN ('SCHEDULED','RUNNING','WAITING_INTERVAL','WAITING_CONNECTION') AND (next_run_at IS NULL OR next_run_at<=?) ORDER BY COALESCE(next_run_at,created_at),id",
      )
      .all(now);
    for (const row of campaigns) {
      this.finishOrWait(row.id);
      const c = this.campaigns.get(row.id);
      try {
        this.campaigns.assertExecutable(c);
      } catch (e) {
        this.db
          .prepare("UPDATE campaigns SET manual_paused=1 WHERE id=?")
          .run(c.id);
        this.campaigns.setState(
          c.id,
          e.code?.startsWith("BUDGET") ? "BUDGET_SUSPENDED" : "REVIEW_REQUIRED",
          e.code + ": " + e.message,
        );
        continue;
      }
      if (
        !ACTIVE.includes(c.execution_status) ||
        Date.parse(c.next_run_at) > this.now()
      )
        continue;
      const r = this.db
        .prepare(
          "SELECT * FROM campaign_recipients WHERE campaign_id=? AND status IN ('PENDING','RETRY_WAIT') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY position LIMIT 1",
        )
        .get(c.id, now);
      if (r) return { c, r };
    }
    return null;
  }
  async tick() {
    if (this.busy) return false;
    this.busy = true;
    try {
      this.beforeDispatch?.();
      await this.provider.refreshIfDue?.();
      if (this.accountStatus().restricted) return false;
      const candidate = this.candidate();
      if (!this.connected()) {
        if (candidate && candidate.c.execution_status !== "WAITING_CONNECTION")
          this.campaigns.setState(
            candidate.c.id,
            "WAITING_CONNECTION",
            "WhatsApp desconectado; nenhuma tentativa iniciada",
          );
        return false;
      }
      const next = this.db
        .prepare("SELECT next_send_at FROM session_dispatch WHERE id=1")
        .get().next_send_at;
      if (next && Date.parse(next) > this.now()) return false;
      const job = this.db
        .prepare(
          "SELECT * FROM outbound_jobs WHERE provider='CLOUD_API' AND status='PENDING' AND due_at<=? ORDER BY priority,created_at,id LIMIT 1",
        )
        .get(utc(this.now()));
      if (job && (!candidate || this.interactiveStreak < 3)) {
        this.interactiveStreak++;
        await this.processJob(job);
        return true;
      }
      if (candidate) {
        this.interactiveStreak = 0;
        await this.processRecipient(candidate.c, candidate.r);
        return true;
      }
      return false;
    } finally {
      this.busy = false;
    }
  }
  leadFor(snapshot, kind, config) {
    const lead = this.db
      .prepare("SELECT * FROM leads WHERE id=?")
      .get(snapshot.lead_id);
    const denied = config
      ? official.eligibility(lead, config.messageCategory, this.now(), kind)
      : null;
    const reason = denied
      ? denied.code + ": " + denied.reason
      : config
        ? null
        : canSend(lead, kind, this.now());
    if (reason) return { reason };
    if (
      lead.phone !== snapshot.phone_snapshot ||
      (snapshot.jid_snapshot && lead.jid !== snapshot.jid_snapshot)
    )
      return { reason: "Identidade do contato mudou desde a preparação" };
    return { lead };
  }
  messageRow(jobId, lead, payload, kind, campaignId, providerId, config) {
    this.db
      .prepare(
        "INSERT INTO messages(id,lead_id,lead_phone,lead_name,direction,text,type,whatsapp_msg_id,campaign_id,timestamp,status,job_id) VALUES(?,?,?,?,'OUTBOUND',?,?,?,?,?,'SENDING',?)",
      )
      .run(
        id(),
        lead.id,
        lead.phone,
        lead.name,
        payload.text || payload.caption || "[" + payload.type + "]",
        kind,
        null,
        campaignId,
        utc(this.now()),
        jobId,
      );
    this.db
      .prepare(
        "UPDATE messages SET correlation_id=?,intended_category=?,approved_category=?,sent_format=?,configuration_json=? WHERE job_id=?",
      )
      .run(
        providerId,
        config.messageCategory,
        config.template?.approvedCategory || null,
        config.template ? "TEMPLATE" : "FREE_FORM",
        JSON.stringify(config),
        jobId,
      );
    this.db
      .prepare("UPDATE messages SET estimate_json=? WHERE job_id=?")
      .run(
        JSON.stringify(official.estimate(this.db, config, [lead], this.now())),
        jobId,
      );
    if (config.template)
      this.db.prepare("UPDATE messages SET text=? WHERE job_id=?").run(
        "[Modelo " +
          config.template.name +
          " · " +
          config.template.language +
          "]\n" +
          config.template.components
            .filter((c) => c.text)
            .map((c) => c.text)
            .join("\n"),
        jobId,
      );
  }
  async processRecipient(c, r) {
    this.beforeDispatch?.(r.lead_id);
    const checked = this.leadFor(r, "CAMPAIGN", c.messageConfig);
    if (checked.reason) {
      this.db
        .prepare(
          "UPDATE campaign_recipients SET status='SKIPPED',error=?,updated_at=? WHERE id=? AND status IN ('PENDING','RETRY_WAIT')",
        )
        .run(checked.reason, utc(this.now()), r.id);
      this.campaigns.event(c.id, "SKIPPED", {
        recipientId: r.id,
        reason: checked.reason,
      });
      this.finishOrWait(c.id);
      return;
    }
    const claim = this.db.transaction(() => {
      const current = this.campaigns.get(c.id);
      if (
        current.manual_paused ||
        current.cancel_requested ||
        current.awaiting_authorization ||
        Date.parse(current.next_run_at) > this.now()
      )
        return null;
      let batch = current.batch;
      if (!batch || batch.status !== "OPEN") {
        const batchId = id(),
          number = current.current_batch + 1;
        this.db
          .prepare(
            "INSERT INTO campaign_batches(id,campaign_id,number,attempt_limit,started_at) VALUES(?,?,?,?,?)",
          )
          .run(batchId, c.id, number, c.config.batchSize, utc(this.now()));
        this.db
          .prepare("UPDATE campaigns SET current_batch=? WHERE id=?")
          .run(number, c.id);
        batch = this.db
          .prepare("SELECT * FROM campaign_batches WHERE id=?")
          .get(batchId);
        this.campaigns.event(c.id, "BATCH_STARTED", { number });
      }
      if (batch.attempts >= batch.attempt_limit) return null;
      const token = id(),
        providerId = id().replace(/-/g, "").toUpperCase(),
        attemptId = id();
      const changed = this.db
        .prepare(
          "UPDATE campaign_recipients SET status='SENDING',owner=?,claim_token=?,attempts=attempts+1,provider_id=?,updated_at=? WHERE id=? AND status IN ('PENDING','RETRY_WAIT')",
        )
        .run(this.owner, token, providerId, utc(this.now()), r.id).changes;
      if (!changed) return null;
      this.db
        .prepare(
          "UPDATE campaign_batches SET attempts=attempts+1 WHERE id=? AND attempts<attempt_limit",
        )
        .run(batch.id);
      this.db
        .prepare(
          "INSERT INTO send_attempts(id,recipient_id,batch_id,number,status,provider_id,claim_token,started_at) VALUES(?,?,?,?,'STARTED',?,?,?)",
        )
        .run(
          attemptId,
          r.id,
          batch.id,
          r.attempts + 1,
          providerId,
          token,
          utc(this.now()),
        );
      this.messageRow(
        attemptId,
        checked.lead,
        { text: r.message_snapshot },
        "PROMOTIONAL",
        c.id,
        providerId,
        c.messageConfig,
      );
      this.holdCadence(
        Math.max(this.minSpacingMs, c.config.pacingSeconds * 1000),
      );
      if (current.execution_status !== "RUNNING")
        this.campaigns.setState(c.id, "RUNNING");
      return { token, providerId, attemptId };
    })();
    if (!claim) return;
    const result = await this.callProvider(
      r.phone_snapshot,
      {
        type: c.messageConfig.type || "TEXT",
        text: r.message_snapshot,
        mediaUrl: c.messageConfig.mediaUrl,
      },
      claim.providerId,
      checked.lead,
      () => {
        this.beforeDispatch?.(r.lead_id);
        const fresh = this.campaigns.get(c.id);
        try {
          this.campaigns.assertExecutable(fresh);
        } catch (e) {
          return e.code + ": " + e.message;
        }
        return this.accountStatus().restricted
          ? "Conta restrita"
          : fresh.manual_paused || fresh.cancel_requested
            ? "Execução suspensa antes da chamada"
            : fresh.review_required ||
                fresh.execution_status === "REVIEW_REQUIRED"
              ? "REVIEW_REQUIRED: configuração suspensa"
              : this.leadFor(r, "CAMPAIGN", c.messageConfig).reason;
      },
      c.messageConfig,
    );
    if (result.accountRestricted)
      this.restrictAccount(result.error || "Restrição informada pelo provedor");
    this.db.transaction(() => {
      const current = this.db
        .prepare(
          "SELECT * FROM campaign_recipients WHERE id=? AND claim_token=? AND owner=?",
        )
        .get(r.id, claim.token, this.owner);
      if (!current) return; // fencing: a stale completion cannot replace another owner's result
      const at = utc(this.now());
      const officialFailure = current.provider_status === "FAILED";
      const evidenced =
        officialFailure ||
        ["SENT", "DELIVERED", "READ"].includes(current.status);
      let state = evidenced
        ? current.status
        : result.success
          ? "SENT"
          : result.uncertain
            ? "UNCERTAIN"
            : "FAILED";
      const transient =
        !evidenced &&
        !result.success &&
        !result.uncertain &&
        result.retryable === true;
      if (
        state === "FAILED" &&
        transient &&
        current.attempts < current.retry_limit
      )
        state = "RETRY_WAIT";
      const retryAt =
        state === "RETRY_WAIT"
          ? utc(
              this.now() +
                Math.min(3600000, 30000 * 2 ** (current.attempts - 1)),
            )
          : null;
      this.db
        .prepare(
          "UPDATE campaign_recipients SET status=?,retryable=?,error=?,next_attempt_at=?,sent_at=COALESCE(sent_at,?),updated_at=? WHERE id=? AND claim_token=?",
        )
        .run(
          state,
          transient ? 1 : 0,
          officialFailure
            ? current.error
            : result.success || evidenced
              ? null
              : result.error || "Falha",
          retryAt,
          ["SENT", "DELIVERED", "READ"].includes(state) ? at : null,
          at,
          r.id,
          claim.token,
        );
      this.db
        .prepare(
          "UPDATE send_attempts SET status=?,finished_at=?,error=? WHERE id=? AND claim_token=?",
        )
        .run(
          ["SENT", "DELIVERED", "READ"].includes(state)
            ? "ACCEPTED"
            : state === "RETRY_WAIT"
              ? "FAILED"
              : state,
          at,
          officialFailure ? current.error : result.error || null,
          claim.attemptId,
          claim.token,
        );
      this.saveMessageResult(claim.attemptId, result, evidenced ? state : null);
      if (result.success)
        this.db
          .prepare(
            "UPDATE campaign_recipients SET provider_status=COALESCE(provider_status,'ACCEPTED') WHERE id=?",
          )
          .run(r.id);
      if (
        [
          "INVALID_CREDENTIAL",
          "PERMISSION_DENIED",
          "TEMPLATE_UNAVAILABLE",
          "CATEGORY_MISMATCH",
          "TEMPLATE_CHANGED",
          "TEMPLATE_STALE",
        ].includes(result.code)
      ) {
        this.db
          .prepare("UPDATE campaigns SET manual_paused=1 WHERE id=?")
          .run(c.id);
        this.campaigns.setState(c.id, "REVIEW_REQUIRED", result.error);
      }
      this.campaigns.event(c.id, "ATTEMPT_RESULT", {
        recipientId: r.id,
        attempt: current.attempts,
        state,
        error: result.error || null,
      });
      this.holdCadence(
        Math.max(this.minSpacingMs, c.config.pacingSeconds * 1000),
      );
      this.finishOrWait(c.id);
    })();
  }
  async callProvider(target, payload, providerId, lead, beforeSend, config) {
    try {
      official.validateMessage(this.db, config, { now: this.now() });
      const reason = beforeSend?.();
      if (reason)
        return {
          success: false,
          definitelyNotSent: true,
          code: reason.split(":")[0],
          error: reason,
        };
      if (config.template)
        payload = {
          ...official.templatePayload(config, lead),
          text: payload.text,
        };
    } catch (e) {
      return {
        success: false,
        definitelyNotSent: true,
        code: e.code,
        error: e.code + ": " + e.message,
      };
    }
    try {
      const result = await this.provider.send(target, payload, providerId, {
        lastInboundAt: lead?.last_inbound_at,
        now: this.now(),
        beforeSend,
        messageConfig: config,
        getLead: () =>
          this.db.prepare("SELECT * FROM leads WHERE id=?").get(lead.id),
      });
      if (!result || (!result.success && result.definitelyNotSent !== true))
        return {
          ...result,
          success: false,
          uncertain: true,
          error: result?.error || "Resultado do provedor desconhecido",
        };
      return result;
    } catch {
      return {
        success: false,
        uncertain: true,
        error: "Chamada interrompida; resultado desconhecido",
      };
    }
  }
  saveMessageResult(jobId, result, evidenced = null) {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE job_id=?")
      .get(jobId);
    if (!row) return;
    if (result.success && result.messageId)
      this.linkProvider(result.messageId, row.correlation_id);
    if (result.success)
      this.db
        .prepare(
          "UPDATE messages SET provider_status=COALESCE(provider_status,'ACCEPTED') WHERE job_id=?",
        )
        .run(jobId);
    const officialFailure = row.provider_status === "FAILED";
    const success =
      !officialFailure &&
      (result.success ||
        evidenced ||
        ["SENT", "DELIVERED", "READ"].includes(row.status));
    const state = officialFailure
      ? "FAILED"
      : ["DELIVERED", "READ"].includes(row.status)
        ? row.status
        : evidenced ||
          (success ? "SENT" : result.uncertain ? "UNCERTAIN" : "FAILED");
    this.db
      .prepare("UPDATE messages SET status=?,error=? WHERE job_id=?")
      .run(
        state,
        officialFailure ? row.error : success ? null : result.error || "Falha",
        jobId,
      );
    if (success && row.status === "SENDING")
      this.db
        .prepare(
          "UPDATE leads SET messages_sent_count=messages_sent_count+1,last_interaction=? WHERE id=?",
        )
        .run(utc(this.now()), row.lead_id);
  }
  jobReason(job) {
    const config = JSON.parse(job.configuration_json);
    let reason = this.leadFor(job, job.kind, config).reason;
    if (!reason)
      try {
        official.validateMessage(this.db, config, { now: this.now() });
      } catch (e) {
        reason = e.code + ": " + e.message;
      }
    if (!reason && job.kind === "REQUESTED_FLOW") {
      const flow = this.db
        .prepare(
          "SELECT active,updated_at,review_required FROM flows WHERE id=?",
        )
        .get(job.source_id);
      if (
        !flow?.active ||
        flow.review_required ||
        flow.updated_at !== job.source_version
      )
        reason = "Fluxo desativado ou alterado";
      if (
        !reason &&
        !this.db
          .prepare(
            "SELECT lead_id FROM lead_flow_sessions WHERE lead_id=? AND job_id=?",
          )
          .get(job.lead_id, job.id)
      )
        reason = "Sessão de fluxo encerrada ou substituída";
    }
    return reason;
  }
  async processJob(job) {
    this.beforeDispatch?.(job.lead_id);
    const reason = this.jobReason(job);
    if (reason) {
      this.db
        .prepare(
          "UPDATE outbound_jobs SET status=?,error=?,updated_at=? WHERE id=? AND status='PENDING'",
        )
        .run(
          job.kind === "REQUESTED_FLOW" && reason.startsWith("WINDOW_EXPIRED")
            ? "WAITING_WINDOW"
            : reason.startsWith("TEMPLATE_") || reason.startsWith("CATEGORY_")
              ? "SUSPENDED"
              : "SKIPPED",
          reason,
          utc(this.now()),
          job.id,
        );
      return;
    }
    const lead = this.db
        .prepare("SELECT * FROM leads WHERE id=?")
        .get(job.lead_id),
      payload = JSON.parse(job.payload_json);
    const providerId = id().replace(/-/g, "").toUpperCase();
    const changed = this.db.transaction(() => {
      const changed = this.db
        .prepare(
          "UPDATE outbound_jobs SET status='SENDING',provider_id=?,updated_at=? WHERE id=? AND status='PENDING'",
        )
        .run(providerId, utc(this.now()), job.id).changes;
      if (changed) {
        this.messageRow(
          job.id,
          lead,
          payload,
          job.kind,
          null,
          providerId,
          JSON.parse(job.configuration_json),
        );
        this.holdCadence(this.minSpacingMs);
      }
      return changed;
    })();
    if (!changed) return;
    const result = await this.callProvider(
      job.phone_snapshot,
      payload,
      providerId,
      lead,
      () => {
        this.beforeDispatch?.(job.lead_id);
        return this.accountStatus().restricted
          ? "Conta restrita"
          : this.jobReason(job);
      },
      JSON.parse(job.configuration_json),
    );
    if (result.accountRestricted)
      this.restrictAccount(result.error || "Restrição informada pelo provedor");
    this.db.transaction(() => {
      const previous = this.db
        .prepare(
          "SELECT status,provider_status,error FROM outbound_jobs WHERE id=?",
        )
        .get(job.id);
      const state =
        previous.provider_status === "FAILED"
          ? "FAILED"
          : ["SENT", "DELIVERED", "READ"].includes(previous.status)
            ? previous.status
            : result.success
              ? "SENT"
              : result.uncertain
                ? "UNCERTAIN"
                : "FAILED";
      this.db
        .prepare(
          "UPDATE outbound_jobs SET status=?,error=?,updated_at=? WHERE id=?",
        )
        .run(
          state,
          previous.provider_status === "FAILED"
            ? previous.error
            : result.error || null,
          utc(this.now()),
          job.id,
        );
      this.saveMessageResult(
        job.id,
        result,
        ["SENT", "DELIVERED", "READ"].includes(state) ? state : null,
      );
      if (result.success)
        this.db
          .prepare(
            "UPDATE outbound_jobs SET provider_status=COALESCE(provider_status,'ACCEPTED') WHERE id=?",
          )
          .run(job.id);
      if (
        job.kind === "REQUESTED_FLOW" &&
        result.code === "WINDOW_EXPIRED" &&
        result.definitelyNotSent
      )
        this.db
          .prepare(
            "UPDATE outbound_jobs SET status='WAITING_WINDOW' WHERE id=?",
          )
          .run(job.id);
      this.holdCadence(this.minSpacingMs);
    })();
  }
  linkProvider(providerId, correlationId) {
    if (!providerId || !correlationId) return false;
    const message = this.db
      .prepare(
        "SELECT * FROM messages WHERE correlation_id=? AND provider='CLOUD_API'",
      )
      .get(correlationId);
    if (!message) return false;
    const existing = this.db
      .prepare(
        "SELECT * FROM cloud_message_links WHERE provider_id=? OR correlation_id=?",
      )
      .all(providerId, correlationId);
    if (
      existing.some(
        (x) =>
          x.provider_id !== providerId || x.correlation_id !== correlationId,
      )
    )
      return false;
    this.db
      .prepare("INSERT OR IGNORE INTO cloud_message_links VALUES(?,?,?)")
      .run(providerId, correlationId, utc(this.now()));
    this.db
      .prepare("UPDATE messages SET whatsapp_msg_id=? WHERE correlation_id=?")
      .run(providerId, correlationId);
    return true;
  }
  cloudReceipt(status) {
    const parsed = require("./cloud-api").CloudApiAdapter.parseStatus(status);
    if (!parsed) return true;
    const known = this.db
      .prepare(
        "SELECT correlation_id FROM cloud_message_links WHERE provider_id=?",
      )
      .get(parsed.providerId);
    const correlation = known?.correlation_id || parsed.correlationId;
    const message =
      correlation &&
      this.db
        .prepare(
          "SELECT * FROM messages WHERE correlation_id=? AND provider='CLOUD_API'",
        )
        .get(correlation);
    if (
      !message ||
      (status.recipient_id && status.recipient_id !== message.lead_phone)
    )
      return false;
    if (!this.linkProvider(parsed.providerId, correlation)) return false;
    if (parsed.accountRestricted)
      this.restrictAccount(
        "ACCOUNT_RESTRICTED: código 131031 em recibo oficial.",
      );
    const pricing = status.pricing
      ? JSON.stringify({
          pricing: status.pricing,
          conversation: status.conversation || null,
          providerTimestamp: status.timestamp || null,
        })
      : null;
    const previousPricing = JSON.parse(message.pricing_json || "null");
    if (
      pricing &&
      (!previousPricing ||
        Number(status.timestamp) > Number(previousPricing.providerTimestamp) ||
        (Number(status.timestamp) ===
          Number(previousPricing.providerTimestamp) &&
          ["DELIVERED", "READ"].includes(parsed.state)))
    ) {
      this.db
        .prepare("UPDATE messages SET pricing_json=? WHERE correlation_id=?")
        .run(pricing, correlation);
      this.db
        .prepare("UPDATE outbound_jobs SET pricing_json=? WHERE provider_id=?")
        .run(pricing, correlation);
    }
    if (parsed.state === "FAILED") {
      const code = status.errors?.[0]?.code;
      const [kind, reason] = require("./cloud-api").classify(code);
      const error =
        kind + ": " + reason + " Código Meta: " + (code || "desconhecido");
      // Failure can supersede accepted/sent, never delivered/read. No receipt creates a retry.
      this.db
        .prepare(
          "UPDATE messages SET status='FAILED',provider_status='FAILED',error=? WHERE correlation_id=? AND status NOT IN ('DELIVERED','READ')",
        )
        .run(error, correlation);
      this.db
        .prepare(
          "UPDATE outbound_jobs SET status='FAILED',provider_status='FAILED',error=? WHERE provider_id=? AND status NOT IN ('DELIVERED','READ')",
        )
        .run(error, correlation);
      const attempt = this.db
        .prepare("SELECT * FROM send_attempts WHERE provider_id=?")
        .get(correlation);
      if (attempt) {
        this.db
          .prepare(
            "UPDATE campaign_recipients SET status='FAILED',provider_status='FAILED',retryable=0,error=? WHERE id=? AND status NOT IN ('DELIVERED','READ')",
          )
          .run(error, attempt.recipient_id);
        const r = this.db
          .prepare("SELECT campaign_id FROM campaign_recipients WHERE id=?")
          .get(attempt.recipient_id);
        this.finishOrWait(r.campaign_id);
      }
      return true;
    }
    if (message.provider_status === "FAILED" && parsed.state === "SENT")
      return true;
    this.receipt(correlation, parsed.state);
    for (const [table, column] of [
      ["messages", "correlation_id"],
      ["outbound_jobs", "provider_id"],
      ["campaign_recipients", "provider_id"],
    ])
      this.db
        .prepare(
          `UPDATE ${table} SET provider_status=? WHERE ${column}=? AND CASE provider_status WHEN 'READ' THEN 3 WHEN 'DELIVERED' THEN 2 WHEN 'SENT' THEN 1 ELSE 0 END<=?`,
        )
        .run(
          parsed.state,
          correlation,
          { SENT: 1, DELIVERED: 2, READ: 3 }[parsed.state],
        );
    return true;
  }
  receipt(providerId, state) {
    if (!["SENT", "DELIVERED", "READ"].includes(state)) return;
    const rank = { SENT: 1, DELIVERED: 2, READ: 3 };
    this.db.transaction(() => {
      const at = utc(this.now());
      const attempt = this.db
        .prepare("SELECT * FROM send_attempts WHERE provider_id=?")
        .get(providerId);
      if (attempt) {
        const r = this.db
          .prepare("SELECT * FROM campaign_recipients WHERE id=?")
          .get(attempt.recipient_id);
        if ((rank[r.status] || 0) < rank[state]) {
          this.db
            .prepare(
              "UPDATE campaign_recipients SET status=?,error=NULL,sent_at=COALESCE(sent_at,?),updated_at=? WHERE id=?",
            )
            .run(state, at, at, r.id);
          this.db
            .prepare(
              "UPDATE send_attempts SET status=CASE WHEN status='STARTED' THEN status ELSE ? END,error=NULL WHERE id=?",
            )
            .run(state, attempt.id);
          this.campaigns.event(r.campaign_id, "PROVIDER_RECEIPT", {
            recipientId: r.id,
            state,
            providerId,
          });
          this.finishOrWait(r.campaign_id);
        }
      }
      const job = this.db
        .prepare("SELECT * FROM outbound_jobs WHERE provider_id=?")
        .get(providerId);
      if (job && (rank[job.status] || 0) < rank[state])
        this.db
          .prepare(
            "UPDATE outbound_jobs SET status=?,error=NULL,updated_at=? WHERE id=?",
          )
          .run(state, at, job.id);
      const msg = this.db
        .prepare(
          "SELECT * FROM messages WHERE correlation_id=? OR whatsapp_msg_id=?",
        )
        .get(providerId, providerId);
      if (msg && (rank[msg.status] || 0) < rank[state]) {
        this.db
          .prepare(
            "UPDATE messages SET status=?,error=NULL,delivered_at=COALESCE(delivered_at,?),read_at=COALESCE(read_at,?) WHERE id=?",
          )
          .run(
            state,
            rank[state] >= 2 ? at : null,
            state === "READ" ? at : null,
            msg.id,
          );
        if (!rank[msg.status])
          this.db
            .prepare(
              "UPDATE leads SET messages_sent_count=messages_sent_count+1 WHERE id=?",
            )
            .run(msg.lead_id);
      }
    })();
  }
}
module.exports = { Dispatcher };
