const { id, utc, fail } = require("./domain");
function consent(
  db,
  leadId,
  status,
  { source, reason, actor = "system", reconfirm = false, evidence = false },
  now = Date.now(),
) {
  if (!["OPT_IN", "OPT_OUT", "PENDING"].includes(status))
    fail("Consentimento inválido.");
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(leadId);
  if (!lead) fail("Contato não encontrado.", 404);
  if (
    status === "OPT_IN" &&
    (!evidence || !reason || (lead.status === "OPT_OUT" && !reconfirm))
  ) {
    fail(
      "Opt-in exige evidência e motivo explícitos. Uma recusa anterior exige reconfirmação manual.",
      409,
      "CONSENT_REQUIRED",
    );
  }
  const at = utc(now);
  reason = reason || "Alteração explícita para " + status;
  db.transaction(() => {
    db.prepare(
      "UPDATE leads SET status=?,consent_method=?,consent_timestamp=?,consent_reason=? WHERE id=?",
    ).run(status, source, at, reason, leadId);
    db.prepare("INSERT INTO consent_events VALUES(?,?,?,?,?,?,?,?)").run(
      id(),
      leadId,
      lead.status,
      status,
      source,
      reason,
      actor,
      at,
    );
    if (status === "OPT_OUT") {
      db.prepare("DELETE FROM lead_flow_sessions WHERE lead_id=?").run(leadId);
      db.prepare(
        "UPDATE outbound_jobs SET status='SKIPPED',error='Descadastro recebido',updated_at=? WHERE lead_id=? AND kind NOT IN ('OPTOUT_CONFIRMATION','HUMAN_REPLY') AND status='PENDING'",
      ).run(at, leadId);
    }
  })();
}
// Internal WappGR attendance/consent policy, not a Baileys protocol requirement.
// Promotions require current opt-in; their eligibility has no 24h service window.
// Account restrictions are independent and enforced globally by the dispatcher.
function canSend(lead, kind, now) {
  if (!lead) return "Contato excluído";
  if (kind === "PROMOTIONAL")
    return lead.status === "OPT_IN"
      ? null
      : "Consentimento atual não autoriza promoção";
  if (kind === "OPTOUT_CONFIRMATION")
    return lead.status === "OPT_OUT"
      ? null
      : "Confirmação de descadastro sem descadastro";
  const inbound = Date.parse(lead.last_inbound_at || "");
  const age = now - inbound;
  const recent = Number.isFinite(inbound) && age >= 0 && age < 24 * 3600000;
  if (kind === "HUMAN_REPLY")
    return recent || lead.status === "OPT_IN"
      ? null
      : "Regra interna: resposta humana exige conversa recebida nas últimas 24h ou opt-in";
  if (kind === "REQUESTED_FLOW")
    return recent && lead.status !== "OPT_OUT"
      ? null
      : "Fluxo exige solicitação recente e ausência de opt-out";
  if (kind === "CONSENT_REPLY")
    return recent
      ? null
      : "Resposta de consentimento exige mensagem recebida recente";
  return "Tipo de mensagem não autorizado";
}
module.exports = { consent, canSend };
