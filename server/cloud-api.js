const { createHmac, timingSafeEqual } = require("node:crypto");
const { fail, hash, utc } = require("./domain");
const policy = require("./official-policy");
function classify(code, http) {
  if ([131031, 368].includes(code))
    return [
      "ACCOUNT_RESTRICTED",
      "Restrição informada pela Meta. Revise a conta no WhatsApp Manager.",
    ];
  if ([190, 102].includes(code) || http === 401)
    return [
      "INVALID_CREDENTIAL",
      "Credencial inválida. Revise o token no servidor.",
    ];
  if ([10, 200, 131005].includes(code) || http === 403)
    return [
      "PERMISSION_DENIED",
      "Permissão ausente. Verifique ativos e permissões do aplicativo.",
    ];
  if (code === 131047)
    return [
      "WINDOW_EXPIRED",
      "Janela encerrada. Aguarde nova mensagem do cliente.",
    ];
  if ([132001, 132015, 132016].includes(code))
    return [
      "TEMPLATE_UNAVAILABLE",
      "Modelo indisponível. Sincronize o catálogo e revise.",
    ];
  if ([130429, 131048, 131056, 4, 80007].includes(code) || http === 429)
    return [
      "RATE_LIMIT",
      "Limite de requisições ou qualidade informado pela plataforma. Aguarde.",
    ];
  if (code === 131049)
    return [
      "PLATFORM_LIMIT",
      "A Meta limitou marketing a este destinatário. Não repetir automaticamente.",
    ];
  if ([131000, 131016].includes(code))
    return ["TRANSIENT", "Falha transitória informada pela plataforma."];
  return [
    "PROVIDER_REJECTED",
    "Chamada recusada. Revise conteúdo, destinatário e configuração.",
  ];
}
class CloudApiAdapter {
  constructor({
    db,
    phoneNumberId,
    wabaId,
    token,
    version,
    appSecret,
    verifyToken,
    fetchImpl = fetch,
    now = Date.now,
  } = {}) {
    Object.assign(this, { db, fetch: fetchImpl, now });
    this.overrides = {
      phoneNumberId,
      wabaId,
      token,
      version,
      appSecret,
      verifyToken,
    };
    this.callbacks = {};
    this.lastError = null;
    this.lastTestAt = null;
    this.nextSyncAt = 0;
    this.closed = false;
  }
  config() {
    const saved = this.db
      ? JSON.parse(
          this.db
            .prepare("SELECT value FROM settings WHERE key='cloudAccount'")
            .get()?.value || "{}",
        )
      : {};
    const e = process.env,
      o = this.overrides;
    return {
      phoneNumberId:
        o.phoneNumberId ??
        (e.WAPPGR_CLOUD_PHONE_NUMBER_ID || saved.phoneNumberId),
      wabaId: o.wabaId ?? (e.WAPPGR_CLOUD_WABA_ID || saved.wabaId),
      version: o.version ?? (e.WAPPGR_GRAPH_VERSION || saved.version),
      token: o.token ?? e.WAPPGR_CLOUD_TOKEN,
      appSecret: o.appSecret ?? e.WAPPGR_META_APP_SECRET,
      verifyToken: o.verifyToken ?? e.WAPPGR_WEBHOOK_VERIFY_TOKEN,
    };
  }
  hasCredentials() {
    return !!this.config().token && process.env.WAPPGR_DISABLE_WHATSAPP !== "1";
  }
  getStatus() {
    const c = this.config(),
      configured =
        /^\d+$/.test(c.phoneNumberId || "") &&
        /^\d+$/.test(c.wabaId || "") &&
        /^v\d+\.0$/.test(c.version || "") &&
        !!c.token;
    return {
      transport: "CLOUD_API",
      status:
        configured &&
        !this.closed &&
        process.env.WAPPGR_DISABLE_WHATSAPP !== "1" &&
        !["INVALID_CREDENTIAL", "PERMISSION_DENIED"].includes(
          this.lastError?.code,
        )
          ? "CONNECTED"
          : "DISCONNECTED",
      configured,
      phoneNumberId: c.phoneNumberId || "",
      wabaId: c.wabaId || "",
      version: c.version || "",
      tokenConfigured: !!c.token,
      signatureConfigured: !!c.appSecret,
      verificationConfigured: !!c.verifyToken,
      lastError: this.lastError,
      lastTestAt: this.lastTestAt,
      verified: !!this.lastTestAt && !this.lastError,
      webhookPath: "/api/webhooks/whatsapp",
      lastWebhookAt:
        this.db?.prepare("SELECT MAX(created_at) at FROM cloud_events").get()
          ?.at || null,
      pendingEvents:
        this.db
          ?.prepare(
            "SELECT COUNT(*) n FROM cloud_events WHERE status='PENDING'",
          )
          .get()?.n || 0,
      lastSyncAt:
        this.db?.prepare("SELECT MAX(synced_at) at FROM cloud_templates").get()
          ?.at || null,
    };
  }
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }
  bindAccount() {
    const c = this.config();
    if (!/^\d+$/.test(c.wabaId || "") || !/^\d+$/.test(c.phoneNumberId || ""))
      fail(
        "Configure a identidade da conta oficial.",
        503,
        "ACCOUNT_CONFIGURATION",
      );
    const identity = { wabaId: c.wabaId, phoneNumberId: c.phoneNumberId };
    const old = this.db
      .prepare("SELECT value FROM settings WHERE key='cloudAccountBinding'")
      .get();
    if (old && old.value !== JSON.stringify(identity))
      fail(
        "A conta configurada diverge da identidade vinculada ao banco. Migração de número exige procedimento separado.",
        409,
        "ACCOUNT_MISMATCH",
      );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('cloudAccountBinding',?,?)",
      )
      .run(JSON.stringify(identity), utc(this.now()));
  }
  async init() {
    this.closed = false;
    this.initializing = this.testPermissions();
    return this.initializing;
  }
  async stop() {
    this.closed = true;
    await Promise.allSettled([this.initializing, this.syncing]);
  }
  async logout() {
    fail(
      "A Cloud API não usa pareamento. Gerencie as credenciais no servidor.",
      409,
    );
  }
  saveConfig(body) {
    for (const k of ["phoneNumberId", "wabaId"])
      if (!/^\d{5,30}$/.test(body[k] || "")) fail(k + " inválido.");
    if (!/^v\d+\.0$/.test(body.version || ""))
      fail("Informe a versão suportada exibida no painel Meta (vNN.0).");
    if (["token", "appSecret", "verifyToken"].some((k) => k in body))
      fail("Segredos devem ficar somente no ambiente do servidor.");
    const config = {
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        version: body.version,
      },
      old = this.config();
    if (
      (old.phoneNumberId && old.phoneNumberId !== config.phoneNumberId) ||
      (old.wabaId && old.wabaId !== config.wabaId)
    )
      fail(
        "Troca de conta exige migração separada para preservar a identidade dos trabalhos.",
        409,
      );
    this.db
      .prepare(
        "INSERT INTO settings(key,value,updated_at) VALUES('cloudAccount',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      )
      .run(JSON.stringify(config), utc(this.now()));
    this.lastError = null;
    this.lastTestAt = null;
    return this.getStatus();
  }
  async request(path) {
    const c = this.config();
    if (!c.token || !/^v\d+\.0$/.test(c.version || ""))
      fail(
        "Configure token e versão Graph no servidor.",
        503,
        "INVALID_CREDENTIAL",
      );
    let response, data;
    try {
      response = await this.fetch(
        "https://graph.facebook.com/" + c.version + "/" + path,
        {
          headers: { Authorization: "Bearer " + c.token },
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        },
      );
      data = await response.json();
    } catch {
      fail(
        "Falha ao consultar a Meta. Verifique conectividade e tente novamente.",
        503,
        "TRANSIENT",
      );
    }
    if (!response.ok) {
      const [code, reason] = classify(data.error?.code, response.status);
      this.lastError = { code, reason, providerCode: data.error?.code || null };
      fail(reason, 503, code);
    }
    return data;
  }
  async testPermissions() {
    this.bindAccount();
    const c = this.config();
    if (!/^\d+$/.test(c.phoneNumberId || "") || !/^\d+$/.test(c.wabaId || ""))
      fail("Configure WABA ID e Phone Number ID.");
    const phone = await this.request(
      c.phoneNumberId +
        "?fields=id,display_phone_number,verified_name,quality_rating",
    );
    const phones = await this.request(
      c.wabaId + "/phone_numbers?fields=id&limit=100",
    );
    if (!phones.data?.some((p) => p.id === c.phoneNumberId))
      fail(
        "Phone Number ID não pertence à WABA configurada.",
        409,
        "ACCOUNT_MISMATCH",
      );
    await this.request(c.wabaId + "/message_templates?fields=id&limit=1");
    this.lastError = null;
    this.lastTestAt = utc(this.now());
    return {
      ...this.getStatus(),
      phone: phone.display_phone_number,
      profileName: phone.verified_name,
      quality: phone.quality_rating,
      note: "Leitura dos ativos e catálogo validada. Confira a permissão de envio no painel Meta; nenhum envio foi realizado.",
    };
  }
  async syncTemplates() {
    if (this.syncing) return this.syncing;
    this.syncing = this.syncCatalog();
    try {
      return await this.syncing;
    } finally {
      this.syncing = null;
    }
  }
  async syncCatalog() {
    this.bindAccount();
    const c = this.config();
    if (!/^\d+$/.test(c.wabaId || "")) fail("Configure WABA ID.");
    const all = [],
      cursors = new Set();
    let after = "";
    do {
      const data = await this.request(
        c.wabaId +
          "/message_templates?fields=id,name,language,status,category,components&limit=100" +
          (after ? "&after=" + encodeURIComponent(after) : ""),
      );
      if (!Array.isArray(data.data))
        fail("Catálogo inválido retornado pela Meta.", 503);
      all.push(...data.data);
      after = data.paging?.next ? data.paging?.cursors?.after : "";
      if (data.paging?.next && (!after || cursors.has(after)))
        fail("Paginação de catálogo inválida.", 503);
      if (after) cursors.add(after);
      if (all.length > 20000)
        fail("Catálogo excede limite local de 20.000 modelos.", 503);
    } while (after);
    const at = utc(this.now());
    this.db.transaction(() => {
      const old = policy.catalog(this.db);
      this.db.prepare("UPDATE cloud_templates SET present=0").run();
      for (const t of all) {
        if (
          ![t.id, t.name, t.language, t.status, t.category].every(
            (x) => typeof x === "string",
          ) ||
          !Array.isArray(t.components)
        )
          fail("Modelo inválido retornado pela Meta.", 503);
        const revision = hash({
            id: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            components: t.components,
          }),
          previous = old.find((x) => x.id === t.id);
        if (
          previous &&
          (previous.revision !== revision ||
            previous.status !== t.status ||
            !previous.present)
        )
          this.archiveTemplate(previous, at);
        this.db
          .prepare(
            `INSERT INTO cloud_templates VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,language=excluded.language,category=excluded.category,status=excluded.status,components_json=excluded.components_json,revision=excluded.revision,synced_at=excluded.synced_at,present=1`,
          )
          .run(
            t.id,
            t.name,
            t.language,
            t.category,
            t.status,
            JSON.stringify(t.components),
            revision,
            at,
          );
      }
      for (const previous of old.filter(
        (t) => t.present && !all.some((x) => x.id === t.id),
      ))
        this.archiveTemplate(previous, at);
      this.suspendAffected();
    })();
    this.nextSyncAt = this.now() + policy.TEMPLATE_TTL_MS - 1000;
    return policy.catalog(this.db);
  }
  archiveTemplate(t, at) {
    this.db
      .prepare(
        "INSERT INTO cloud_template_history(template_id,snapshot_json,recorded_at) VALUES(?,?,?)",
      )
      .run(t.id, JSON.stringify(t), at);
  }
  suspendAffected() {
    for (const table of ["campaigns", "flows", "schedules"])
      for (const row of this.db
        .prepare(
          `SELECT * FROM ${table} WHERE message_category IS NOT NULL AND review_required=0`,
        )
        .all()) {
        const configs =
          table === "flows"
            ? JSON.parse(row.steps_json).map((s) => ({
                ...s,
                messageCategory: s.messageCategory || row.message_category,
              }))
            : [JSON.parse(row.message_config_json)];
        let problem;
        for (const config of configs) {
          try {
            policy.validateMessage(this.db, config, {
              now: this.now(),
              fresh: false,
            });
          } catch (e) {
            problem = e;
            break;
          }
        }
        if (!problem) continue;
        policy.history(this.db, table, row.id, row, "catalog-sync", this.now());
        const reason = problem.code + ": " + problem.message;
        if (
          table === "campaigns" &&
          ![
            "LEGACY",
            "COMPLETED",
            "COMPLETED_WITH_FAILURES",
            "CANCELLED",
            "DRAFT",
          ].includes(row.execution_status)
        ) {
          this.db
            .prepare(
              "UPDATE campaigns SET manual_paused=1,review_required=1,execution_status='REVIEW_REQUIRED',reason=? WHERE id=?",
            )
            .run(reason, row.id);
          this.db
            .prepare(
              "INSERT INTO campaign_events(campaign_id,kind,details,actor,created_at) VALUES(?,?,?,?,?)",
            )
            .run(
              row.id,
              "TEMPLATE_REVIEW",
              JSON.stringify({ reason }),
              "provider",
              utc(this.now()),
            );
        } else if (table !== "campaigns") {
          this.db
            .prepare(
              `UPDATE ${table} SET active=0,review_required=1 WHERE id=?`,
            )
            .run(row.id);
          if (table === "flows") {
            this.db
              .prepare(
                "UPDATE outbound_jobs SET status='SUSPENDED',error=? WHERE source_id=? AND status='PENDING'",
              )
              .run(reason, row.id);
            this.db
              .prepare(
                "UPDATE lead_flow_sessions SET status='REVIEW_REQUIRED',reason=? WHERE flow_id=?",
              )
              .run(reason, row.id);
          }
        }
      }
  }
  async refreshIfDue() {
    if (this.closed || !this.hasCredentials() || this.now() < this.nextSyncAt)
      return;
    this.nextSyncAt = this.now() + 60000;
    try {
      await this.syncTemplates();
    } catch (e) {
      this.lastError = { code: e.code, reason: e.message };
    }
  }
  buildMessage(target, payload, correlationId) {
    if (!/^[1-9]\d{9,14}$/.test(target))
      fail("Cloud API exige telefone com DDI, sem JID/LID.");
    const base = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: target,
      biz_opaque_callback_data: correlationId,
    };
    if (payload.type === "TEMPLATE")
      return {
        ...base,
        type: "template",
        template: {
          name: payload.templateName,
          language: { code: payload.language },
          components: payload.components || [],
        },
      };
    const options = payload.options
      ?.map((o) => o.keyword + " — " + o.label)
      .join("\n");
    const body = (payload.text || "") + (options ? "\n\n" + options : "");
    if (payload.type === "TEXT") {
      if (!body.trim() || body.length > 4096)
        fail("Texto livre deve ter entre 1 e 4096 caracteres.");
      return { ...base, type: "text", text: { preview_url: false, body } };
    }
    if (!["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(payload.type))
      fail("Formato não suportado.");
    const type = payload.type.toLowerCase(),
      link = policy.httpsMedia(payload.mediaUrl);
    if (type === "audio" && body.trim())
      fail("Áudio não aceita legenda. Envie o texto em uma mensagem separada.");
    if (body.length > 1024) fail("Legenda deve ter até 1024 caracteres.");
    return {
      ...base,
      type,
      [type]: { link, ...(type === "audio" || !body ? {} : { caption: body }) },
    };
  }
  async send(target, payload, correlationId, context = {}) {
    let body;
    try {
      this.bindAccount();
      if (this.getStatus().status !== "CONNECTED")
        fail(
          "Integração não configurada ou indisponível.",
          503,
          "INVALID_CREDENTIAL",
        );
      const config = policy.validateMessage(this.db, context.messageConfig, {
        now: this.now(),
      });
      if (config.template)
        payload = policy.templatePayload(config, context.getLead?.() || {});
      else if (payload.type !== (config.type || "TEXT"))
        fail("Formato diverge da configuração revisada.");
      body = this.buildMessage(target, payload, correlationId);
      const reason = context.beforeSend?.();
      if (reason) fail(reason, 409, reason.split(":")[0]);
      if (
        context.messageConfig.messageCategory === "SERVICE" &&
        !policy.windowOpen(context.getLead?.(), this.now())
      )
        fail("Janela encerrada.", 409, "WINDOW_EXPIRED");
    } catch (e) {
      return {
        success: false,
        definitelyNotSent: true,
        retryable: false,
        code: e.code || "VALIDATION",
        error: (e.code || "VALIDATION") + ": " + e.message,
      };
    }
    const c = this.config();
    try {
      const response = await this.fetch(
        `https://graph.facebook.com/${c.version}/${c.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + c.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        },
      );
      const result = await response.json();
      if (response.ok && result.messages?.[0]?.id)
        return {
          success: true,
          messageId: result.messages[0].id,
          correlationId,
          accepted: true,
        };
      if (response.status >= 500 || response.ok)
        return {
          success: false,
          uncertain: true,
          code: "UNCERTAIN",
          error: "Resposta sem certeza de aceitação; sem reenvio automático.",
        };
      const [code, reason] = classify(result.error?.code, response.status);
      if (["INVALID_CREDENTIAL", "PERMISSION_DENIED"].includes(code))
        this.lastError = { code, reason };
      return {
        success: false,
        definitelyNotSent: true,
        retryable: ["RATE_LIMIT", "TRANSIENT"].includes(code),
        accountRestricted: code === "ACCOUNT_RESTRICTED",
        code,
        error:
          code +
          ": " +
          reason +
          " Código Meta: " +
          (result.error?.code || response.status),
      };
    } catch {
      return {
        success: false,
        uncertain: true,
        code: "UNCERTAIN",
        error: "Resultado de rede incerto; sem reenvio automático.",
      };
    }
  }
  static verifySignature(raw, signature, secret) {
    if (!secret || typeof signature !== "string" || !Buffer.isBuffer(raw))
      return false;
    const expected =
      "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    return (
      Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }
  verifyChallenge(q) {
    const expected = this.config().verifyToken,
      given = q["hub.verify_token"];
    return (
      q["hub.mode"] === "subscribe" &&
      typeof expected === "string" &&
      expected.length > 0 &&
      typeof given === "string" &&
      Buffer.byteLength(expected) === Buffer.byteLength(given) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(given))
    );
  }
  acceptWebhook(raw, signature) {
    if (
      !CloudApiAdapter.verifySignature(raw, signature, this.config().appSecret)
    )
      fail("Assinatura de webhook inválida.", 401, "WEBHOOK_SIGNATURE");
    this.bindAccount();
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      fail("JSON inválido.");
    }
    if (
      payload.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry)
    )
      fail("Evento WhatsApp inválido.");
    const c = this.config();
    return this.db.transaction(() => {
      let count = 0;
      for (const entry of payload.entry) {
        if (String(entry.id) !== c.wabaId) continue;
        for (const change of entry.changes || []) {
          if (
            change.field === "messages" &&
            String(change.value?.metadata?.phone_number_id) !== c.phoneNumberId
          )
            continue;
          const event = { wabaId: String(entry.id), ...change };
          count += this.db
            .prepare(
              "INSERT OR IGNORE INTO cloud_events(id,payload_json,created_at) VALUES(?,?,?)",
            )
            .run(hash(event), JSON.stringify(event), utc(this.now())).changes;
        }
      }
      return count;
    })();
  }
  processEvents(dispatcher, flows) {
    for (const row of this.db
      .prepare(
        "SELECT * FROM cloud_events WHERE status='PENDING' ORDER BY COALESCE(processed_at,created_at),rowid LIMIT 50",
      )
      .all()) {
      try {
        this.db.transaction(() => {
          const event = JSON.parse(row.payload_json),
            v = event.value || {};
          let unmatched = false;
          if (event.field === "messages") {
            for (const m of v.messages || []) {
              const stamp = Number(m.timestamp) * 1000;
              if (
                !/^[1-9]\d{9,14}$/.test(m.from || "") ||
                !m.id ||
                !Number.isFinite(stamp) ||
                stamp <= 0 ||
                stamp > this.now() + 60000
              )
                continue;
              flows.receive({
                msgId: m.id,
                remoteJid: m.from + "@s.whatsapp.net",
                phone: "+" + m.from,
                pushName: v.contacts?.find((c) => c.wa_id === m.from)?.profile
                  ?.name,
                text:
                  m.text?.body ||
                  m.button?.text ||
                  m.interactive?.button_reply?.title ||
                  m.interactive?.list_reply?.title ||
                  m[m.type]?.caption ||
                  "[" + m.type + "]",
                clientTimestamp: utc(stamp),
                provider: "CLOUD_API",
                webhookEventId: row.id,
              });
            }
            for (const s of v.statuses || [])
              if (!dispatcher.cloudReceipt(s)) unmatched = true;
          } else if (
            [
              "message_template_status_update",
              "template_category_update",
              "message_template_category_update",
              "message_template_quality_update",
            ].includes(event.field)
          ) {
            // Arrival order is not authoritative: a fresh GET must revalidate the template.
            const tid = String(v.message_template_id || v.id || ""),
              ts = tid
                ? this.db
                    .prepare("SELECT * FROM cloud_templates WHERE id=?")
                    .all(tid)
                : this.db.prepare("SELECT * FROM cloud_templates").all();
            for (const t of ts) {
              this.archiveTemplate(t, utc(this.now()));
              this.db
                .prepare(
                  "UPDATE cloud_templates SET status='PENDING_REVALIDATION' WHERE id=?",
                )
                .run(t.id);
            }
            this.nextSyncAt = 0;
            this.suspendAffected();
          } else if (
            event.field === "account_update" &&
            ["DISABLED", "BANNED", "RESTRICTED"].includes(v.event)
          )
            dispatcher.restrictAccount(
              "ACCOUNT_RESTRICTED: evento de conta " + v.event,
            );
          this.db
            .prepare(
              "UPDATE cloud_events SET status=?,processed_at=?,error=? WHERE id=?",
            )
            .run(
              unmatched ? "PENDING" : "PROCESSED",
              utc(this.now()),
              unmatched
                ? "Aguardando associação do ID oficial; evento preservado"
                : null,
              row.id,
            );
        })();
      } catch (e) {
        this.db
          .prepare("UPDATE cloud_events SET status='ERROR',error=? WHERE id=?")
          .run(e.code || "PROCESSING_ERROR", row.id);
      }
    }
  }
  static parseStatus(s) {
    const state = {
      sent: "SENT",
      delivered: "DELIVERED",
      read: "READ",
      failed: "FAILED",
    }[s.status];
    return state
      ? {
          providerId: s.id,
          correlationId: s.biz_opaque_callback_data,
          state,
          accountRestricted: s.errors?.some((e) => e.code === 131031) || false,
        }
      : null;
  }
}
module.exports = { CloudApiAdapter, classify };
