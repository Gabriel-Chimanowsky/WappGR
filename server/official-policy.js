const categories = require("../shared/message-categories.json");
const { templateSlots, slotId } = require("../shared/template-parameters.mjs");
const { fail, hash, utc, id } = require("./domain");
const WINDOW_MS = 24 * 3600000;
const TEMPLATE_TTL_MS = 5 * 60000;
function category(value, required = true) {
  if (value === undefined || value === null || value === "") {
    if (required)
      fail("Selecione a Categoria da mensagem.", 400, "CATEGORY_REQUIRED");
    return null;
  }
  if (!categories.some((c) => c.value === value))
    fail("Categoria da mensagem inválida.", 400, "CATEGORY_INVALID");
  return value;
}
function windowOpen(lead, now = Date.now()) {
  const age = now - Date.parse(lead?.cloud_last_inbound_at || "");
  return Number.isFinite(age) && age >= 0 && age < WINDOW_MS;
}
function catalog(db) {
  return db
    .prepare("SELECT * FROM cloud_templates ORDER BY name,language")
    .all()
    .map(templateView);
}
function templateView(row) {
  const components = JSON.parse(row.components_json);
  let slots = [],
    unsupported = null;
  try {
    slots = templateSlots(components);
  } catch (e) {
    unsupported = e.message;
  }
  return { ...row, components, slots, unsupported };
}
function httpsMedia(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("URL de mídia inválida.");
  }
  const hosts = (process.env.WAPPGR_MEDIA_HOSTS || "")
    .split(",")
    .map((s) => s.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hosts.includes(url.hostname)
  )
    fail("Mídia exige HTTPS e domínio autorizado em WAPPGR_MEDIA_HOSTS.");
  return url.href;
}
function validateMessage(
  db,
  input = {},
  { required = true, now = Date.now(), fresh = true } = {},
) {
  const intent = category(input.messageCategory, required);
  const result = {
    messageCategory: intent,
    relatedReference: String(input.relatedReference || "").slice(0, 500),
  };
  if (
    input.maxBudget !== undefined &&
    input.maxBudget !== "" &&
    input.maxBudget !== null
  ) {
    const budget = Number(input.maxBudget);
    if (
      !Number.isFinite(budget) ||
      budget < 0 ||
      budget > 1e9 ||
      !/^[A-Z]{3}$/.test(input.currency || "")
    )
      fail("Orçamento exige valor não negativo e moeda de três letras.");
    result.maxBudget = budget;
    result.currency = input.currency;
  }
  if (!intent) return result;
  if (intent === "SERVICE") {
    if (input.template)
      fail(
        "Serviço usa mensagem livre; remova o modelo.",
        400,
        "CATEGORY_MISMATCH",
      );
    const type = input.type || "TEXT";
    if (!["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(type))
      fail("Formato de mensagem livre inválido.");
    if (type === "AUDIO" && String(input.message || "").trim())
      fail(
        "Áudio não aceita legenda. Limpe a mensagem de texto ou use um fluxo com acompanhamento separado.",
      );
    result.type = type;
    if (type !== "TEXT") result.mediaUrl = httpsMedia(input.mediaUrl);
    return result;
  }
  if (!input.template) {
    if (!required) return result;
    fail("Selecione um modelo aprovado compatível.", 400, "TEMPLATE_REQUIRED");
  }
  const t = db
    .prepare("SELECT * FROM cloud_templates WHERE id=?")
    .get(String(input.template.id || ""));
  if (!t || !t.present || t.status !== "APPROVED")
    fail(
      "Modelo ausente ou não aprovado. Sincronize o catálogo e revise a configuração.",
      409,
      "TEMPLATE_UNAVAILABLE",
    );
  if (t.category !== intent)
    fail(
      "Categoria aprovada do modelo diverge da intenção. Revise sem trocar a categoria automaticamente.",
      409,
      "CATEGORY_MISMATCH",
    );
  if (
    fresh &&
    (now - Date.parse(t.synced_at) >= TEMPLATE_TTL_MS ||
      Date.parse(t.synced_at) > now)
  )
    fail(
      "Catálogo vencido. Sincronize os modelos antes de executar.",
      409,
      "TEMPLATE_STALE",
    );
  if (!input.template.revision || t.revision !== input.template.revision)
    fail(
      "Conteúdo ou classificação do modelo mudou. Selecione novamente e revise.",
      409,
      "TEMPLATE_CHANGED",
    );
  const view = templateView(t);
  if (view.unsupported) fail(view.unsupported, 400, "TEMPLATE_UNSUPPORTED");
  const parameters = input.template.parameters || {};
  if (typeof parameters !== "object" || Array.isArray(parameters))
    fail("Mapeamento de parâmetros inválido.");
  const allowed = new Set(view.slots.map(slotId));
  if (Object.keys(parameters).some((k) => !allowed.has(k)))
    fail("Parâmetro não previsto no modelo aprovado.");
  const mapped = {};
  for (const slot of view.slots) {
    const key = slotId(slot),
      p = parameters[key];
    if (!p || !["literal", "name", "phone", "category"].includes(p.source))
      fail("Preencha o parâmetro " + key, 400, "TEMPLATE_PARAMETERS");
    if (slot.type !== "text" && p.source !== "literal")
      fail("Mídia exige URL literal.");
    if (
      p.source === "literal" &&
      (typeof p.value !== "string" || !p.value.trim() || p.value.length > 1024)
    )
      fail("Valor inválido: " + key);
    if (slot.type !== "text") httpsMedia(p.value);
    mapped[key] = {
      source: p.source,
      ...(p.source === "literal" ? { value: p.value } : {}),
    };
  }
  result.template = {
    id: t.id,
    name: t.name,
    language: t.language,
    approvedCategory: t.category,
    revision: t.revision,
    components: view.components,
    parameters: mapped,
    syncedAt: t.synced_at,
  };
  return result;
}
function templatePayload(config, lead) {
  const t = config.template,
    groups = new Map();
  for (const slot of templateSlots(t.components)) {
    const p = t.parameters[slotId(slot)];
    const value =
      p.source === "literal"
        ? p.value
        : p.source === "name"
          ? lead.name
          : p.source === "phone"
            ? lead.phone
            : lead.category_name || "";
    const key = slot.component + (slot.index ?? "");
    if (!groups.has(key))
      groups.set(key, {
        type: slot.component,
        ...(slot.index === undefined
          ? {}
          : { index: slot.index, sub_type: slot.sub_type }),
        parameters: [],
      });
    groups
      .get(key)
      .parameters.push(
        slot.type === "text"
          ? {
              type: "text",
              text: value,
              ...(/^\d+$/.test(slot.key) ? {} : { parameter_name: slot.key }),
            }
          : { type: slot.type, [slot.type]: { link: value } },
      );
  }
  return {
    type: "TEMPLATE",
    templateName: t.name,
    language: t.language,
    components: [...groups.values()],
  };
}
function eligibility(lead, intent, now, kind = "CAMPAIGN") {
  if (!lead) return { code: "CONTACT_MISSING", reason: "Contato excluído." };
  if (
    lead.status === "OPT_OUT" &&
    !["HUMAN_REPLY", "OPTOUT_CONFIRMATION"].includes(kind)
  )
    return { code: "OPT_OUT", reason: "Descadastro recebido. Não enviar." };
  if (intent === "MARKETING" && lead.status !== "OPT_IN")
    return {
      code: "CONSENT_REQUIRED",
      reason: "Marketing exige consentimento atual registrado.",
    };
  if (intent === "SERVICE" && !windowOpen(lead, now))
    return {
      code: "WINDOW_EXPIRED",
      reason: "Janela de 24 horas encerrada. Aguarde nova mensagem do cliente.",
    };
  if (
    intent === "UTILITY" &&
    lead.status !== "OPT_IN" &&
    !windowOpen(lead, now)
  )
    return {
      code: "CONSENT_REQUIRED",
      reason:
        "Utilidade exige autorização registrada ou solicitação recente do cliente.",
    };
  return null;
}
function saveRates(db, input, now = Date.now()) {
  if (
    !/^[A-Z]{3}$/.test(input.currency || "") ||
    !/^https:\/\//.test(input.source || "") ||
    !Number.isFinite(Date.parse(input.effectiveAt)) ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.effectiveAt) ||
    !Array.isArray(input.rates) ||
    !input.rates.length
  )
    fail("Informe moeda, fonte HTTPS, vigência e tabela de tarifas.");
  const seen = new Set();
  for (const r of input.rates) {
    category(r.category);
    if (
      !/^\d{1,6}$/.test(r.prefix || "") ||
      typeof r.amount !== "number" ||
      !Number.isFinite(r.amount) ||
      r.amount < 0 ||
      seen.has(r.prefix + r.category)
    )
      fail(
        "Tarifa inválida ou repetida. Use prefixo internacional, categoria e valor não negativo.",
      );
    seen.add(r.prefix + r.category);
  }
  const data = {
    rates: input.rates,
    freeServiceWindow: input.freeServiceWindow === true,
    freeUtilityWindow: input.freeUtilityWindow === true,
  };
  const rateId = id();
  db.prepare("INSERT INTO cloud_rates VALUES(?,?,?,?,?,?,?)").run(
    rateId,
    input.currency,
    input.source,
    utc(input.effectiveAt),
    utc(input.expiresAt),
    JSON.stringify(data),
    utc(now),
  );
  return { id: rateId };
}
function estimate(db, config, leads, now = Date.now()) {
  const result = {
    available: false,
    label: "Estimativa indisponível",
    messageCategory: config.messageCategory,
    template: config.template
      ? { name: config.template.name, language: config.template.language }
      : null,
    eligible: leads.length,
    messages: leads.length,
    currency: config.currency || null,
    total: null,
    reason:
      "Falta tabela de tarifas vigente com fonte, data e cobertura dos destinatários.",
  };
  const rate = db
    .prepare(
      "SELECT * FROM cloud_rates WHERE effective_at<=? AND expires_at>? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
    .get(utc(now), utc(now));
  if (
    !rate ||
    !config.messageCategory ||
    (config.currency && config.currency !== rate.currency)
  )
    return result;
  const data = JSON.parse(rate.data_json),
    details = [];
  let total = 0,
    free = 0;
  for (const lead of leads) {
    const price = data.rates
      .filter(
        (r) =>
          r.category === config.messageCategory &&
          lead.phone.startsWith(r.prefix),
      )
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!price) return result;
    const isFree =
      windowOpen(lead, now) &&
      ((config.messageCategory === "SERVICE" && data.freeServiceWindow) ||
        (config.messageCategory === "UTILITY" && data.freeUtilityWindow));
    const amount = isFree ? 0 : price.amount;
    total += amount;
    if (isFree) free++;
    if (!details.some((d) => d.prefix === price.prefix && d.amount === amount))
      details.push({
        prefix: price.prefix,
        referenceRate: price.amount,
        amount,
      });
  }
  return {
    ...result,
    available: true,
    label: "Estimativa de referência",
    reason: null,
    rateVersion: rate.id,
    currency: rate.currency,
    source: rate.source,
    effectiveAt: rate.effective_at,
    expiresAt: rate.expires_at,
    total: Math.round(total * 1e6) / 1e6,
    rates: details,
    freeMessages: free,
    conditions:
      "Gratuidade só aplicada com regra vigente importada e evidência de janela aberta. Não inclui descontos por volume nem entrada gratuita por anúncio. Não substitui a fatura Meta.",
  };
}
function budgetReason(config, cost) {
  if (config.maxBudget === undefined) return null;
  if (!cost.available)
    return "BUDGET_UNAVAILABLE: orçamento configurado, mas a estimativa está indisponível. Atualize a tarifa.";
  return cost.total > config.maxBudget
    ? "BUDGET_EXCEEDED: estimativa excede o orçamento máximo. Revise antes de continuar."
    : null;
}
function history(db, type, entityId, snapshot, actor, now) {
  db.prepare(
    "INSERT INTO configuration_history(entity_type,entity_id,snapshot_json,actor,created_at) VALUES(?,?,?,?,?)",
  ).run(type, entityId, JSON.stringify(snapshot), actor, utc(now));
}
module.exports = {
  categories,
  category,
  windowOpen,
  validateMessage,
  eligibility,
  templatePayload,
  templateView,
  catalog,
  httpsMedia,
  estimate,
  saveRates,
  budgetReason,
  history,
  TEMPLATE_TTL_MS,
  WINDOW_MS,
  hash,
};
