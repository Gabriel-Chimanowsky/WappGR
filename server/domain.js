const { createHash, randomUUID } = require("node:crypto");

class AppError extends Error {
  constructor(status, message, code = "VALIDATION") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status = 400, code) => {
  throw new AppError(status, message, code);
};
function integer(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    fail(name + " deve estar entre " + min + " e " + max + ".");
  return n;
}
function text(value, name, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(name + " inválido (máximo " + max + " caracteres).");
  return value.trim();
}
function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (raw.includes("@") || raw.startsWith("lid:")) return "";
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") && (digits.length === 10 || digits.length === 11))
    digits = "55" + digits;
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : "";
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
const utc = (value) => new Date(value).toISOString();
function zone(value = "America/Sao_Paulo") {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    fail("Fuso horário inválido.");
  }
  return value;
}
function page(query = {}) {
  return {
    page: integer(query.page, 1, 1, 1000000, "Página"),
    limit: integer(query.limit, 50, 1, 500, "Limite"),
  };
}
function validateSelection(selection) {
  if (
    !selection ||
    typeof selection !== "object" ||
    Array.isArray(selection) ||
    (selection.type !== undefined &&
      !["ids", "filters"].includes(selection.type))
  )
    fail("Tipo de seleção inválido.");
  for (const field of ["ids", "excludedIds"])
    if (
      selection[field] !== undefined &&
      (!Array.isArray(selection[field]) ||
        selection[field].length > 100000 ||
        selection[field].some(
          (value) => typeof value !== "string" || !value || value.length > 200,
        ))
    )
      fail("IDs da seleção inválidos.");
  if (selection.type === "ids" && !Array.isArray(selection.ids))
    fail("Seleção por IDs exige uma lista.");
  if (
    selection.filters !== undefined &&
    (!selection.filters ||
      typeof selection.filters !== "object" ||
      Array.isArray(selection.filters))
  )
    fail("Filtros inválidos.");
  const filters =
    selection.filters || (selection.type === "ids" ? {} : selection);
  for (const field of ["categoryId", "category", "status", "search"])
    if (
      filters[field] !== undefined &&
      (typeof filters[field] !== "string" || filters[field].length > 200)
    )
      fail("Valor de filtro inválido: " + field);
}
function csv(rows, fields) {
  const esc = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      fields.map((f) => esc(f.label)).join(";"),
      ...rows.map((r) => fields.map((f) => esc(r[f.key])).join(";")),
    ].join("\r\n")
  );
}
function identity(lead) {
  return lead && { phone: lead.phone, jid: lead.jid || null };
}
function validDestination(lead) {
  return (
    !!lead &&
    !!normalizePhone("+" + lead.phone) &&
    !String(lead.phone).startsWith("lid:")
  );
}
function personalize(message, lead) {
  return message
    .replace(/{nome}/g, () => lead.name)
    .replace(/{categoria}/g, () => lead.category_name || "")
    .replace(/{telefone}/g, () => lead.phone);
}
module.exports = {
  AppError,
  fail,
  integer,
  text,
  normalizePhone,
  hash,
  utc,
  zone,
  page,
  validateSelection,
  csv,
  identity,
  validDestination,
  personalize,
  id: randomUUID,
};
