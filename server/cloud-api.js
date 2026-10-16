// Prepared transport, deliberately not selected by server/index.js.
// Production activation also requires signed inbound/status webhooks and a verified template catalog.
const { createHmac, timingSafeEqual } = require("node:crypto");
class CloudApiAdapter {
  constructor({
    phoneNumberId,
    token,
    version,
    approvedTemplates = [],
    fetchImpl = fetch,
  } = {}) {
    this.phoneNumberId = phoneNumberId;
    this.token = token;
    this.version = version;
    this.approvedTemplates = approvedTemplates;
    this.fetch = fetchImpl;
  }
  getStatus() {
    return {
      status:
        this.phoneNumberId &&
        this.token &&
        /^v\d+\.\d+$/.test(this.version || "")
          ? "CONNECTED"
          : "DISCONNECTED",
      transport: "CLOUD_API",
    };
  }
  buildMessage(target, payload, correlationId, context = {}) {
    if (!/^\d{10,15}$/.test(target))
      throw Error("Cloud API exige telefone com DDI, sem JID/LID.");
    const base = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: target,
      biz_opaque_callback_data: correlationId,
    };
    if (payload.type === "TEMPLATE") {
      const template = this.approvedTemplates.find(
        (t) =>
          t.name === payload.templateName &&
          t.language === payload.language &&
          t.status === "APPROVED",
      );
      if (!template)
        throw Error("Template não consta no catálogo aprovado do servidor.");
      return {
        ...base,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          components: payload.components || [],
        },
      };
    }
    const age =
      (context.now ?? Date.now()) - Date.parse(context.lastInboundAt || "");
    if (!Number.isFinite(age) || age < 0 || age >= 24 * 3600000)
      throw Error(
        "Janela de atendimento encerrada: é necessário template aprovado.",
      );
    if (payload.type !== "TEXT")
      throw Error(
        "Adaptador preparado suporta texto e template; mídia oficial exige integração adicional.",
      );
    return {
      ...base,
      type: "text",
      text: { preview_url: false, body: payload.text },
    };
  }
  async send(target, payload, correlationId, context = {}) {
    let body;
    try {
      if (this.getStatus().status !== "CONNECTED")
        throw Error("Credenciais Cloud API não configuradas.");
      body = this.buildMessage(target, payload, correlationId, context);
      const reason = context.beforeSend?.();
      if (reason) throw Error(reason);
    } catch (error) {
      return {
        success: false,
        definitelyNotSent: true,
        retryable: false,
        error: error.message,
      };
    }
    try {
      const response = await this.fetch(
        "https://graph.facebook.com/" +
          this.version +
          "/" +
          this.phoneNumberId +
          "/messages",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        },
      );
      const result = await response.json();
      if (response.ok && result.messages?.[0]?.id)
        return {
          success: true,
          messageId: result.messages[0].id,
          correlationId,
        };
      if (response.status >= 500)
        return {
          success: false,
          uncertain: true,
          error: "Erro do provedor sem certeza de aceitação",
        };
      return {
        success: false,
        definitelyNotSent: true,
        retryable: response.status === 429,
        accountRestricted:
          [401, 403].includes(response.status) || result.error?.code === 131031,
        error:
          "Cloud API recusou a chamada (" +
          (result.error?.code || response.status) +
          ")",
      };
    } catch {
      return {
        success: false,
        uncertain: true,
        error: "Resultado de rede incerto; sem retry automático",
      };
    }
  }
  static verifySignature(rawBody, signature, appSecret) {
    if (!appSecret || typeof signature !== "string") return false;
    const expected =
      "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
    return (
      Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }
  static parseStatus(status) {
    const state = {
      sent: "SENT",
      delivered: "DELIVERED",
      read: "READ",
      failed: "FAILED",
    }[status.status];
    return state
      ? {
          providerId: status.id,
          correlationId: status.biz_opaque_callback_data,
          state,
          accountRestricted:
            status.errors?.some((e) => e.code === 131031) || false,
        }
      : null;
  }
}
module.exports = { CloudApiAdapter };
