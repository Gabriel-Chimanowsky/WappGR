// Linear parser: separators and embedded newlines are recognized only outside quotes.
export function parseRows(input, separator) {
  if (typeof input !== "string" || input.length > 10000000)
    throw Error("Texto excede 10 MB.");
  const text = input.replace(/^\uFEFF/, "");
  if (!separator) {
    const counts = new Map([
      [";", 0],
      ["\t", 0],
      ["|", 0],
      [",", 0],
    ]);
    let quote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quote && text[i + 1] === '"') {
          i++;
          continue;
        }
        quote = !quote;
      }
      if (!quote) {
        if (c === "\n" || c === "\r") break;
        if (counts.has(c)) counts.set(c, counts.get(c) + 1);
      }
    }
    separator = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"' && !field && !closed) {
      quoted = true;
      continue;
    }
    if (c === separator) {
      cell();
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
      continue;
    }
    if (closed && c.trim())
      throw Error("Texto após fechamento de aspas. Revise o CSV.");
    if (!closed) field += c;
  }
  if (quoted) throw Error("Aspas não fechadas no CSV.");
  if (field || row.length || closed) line();
  return rows;
}
const normalized = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
export function parseLeads(input) {
  const rows = parseRows(input);
  if (!rows.length) return [];
  const names = {
    name: ["nome", "name", "contato", "cliente"],
    phone: ["telefone", "celular", "phone", "whatsapp", "numero"],
    category: ["categoria", "category", "grupo", "etiquetas", "tags"],
    status: ["status", "status de consentimento", "consentimento"],
    notes: ["observacoes", "notas", "notes", "descricao"],
    createdAt: ["data de cadastro", "cadastro", "desde", "criado"],
    lastInteraction: ["ultimo envio", "ultima interacao"],
    messagesSentCount: ["envios realizados"],
  };
  const columns = {};
  rows[0].forEach((v, i) => {
    const key = Object.keys(names).find((k) =>
      names[k].includes(normalized(v)),
    );
    if (key) columns[key] = i;
  });
  const header = columns.phone !== undefined;
  return rows
    .slice(header ? 1 : 0)
    .map((row) => {
      const lead = {};
      if (header) {
        for (const [key, i] of Object.entries(columns))
          lead[key] = row[i]?.trim() || "";
      } else {
        const p = row.findIndex((v) => v.replace(/\D/g, "").length >= 10);
        if (p < 0) return null;
        lead.phone = row[p].trim();
        lead.name = row.find((v, i) => i !== p && v.trim())?.trim() || "";
      }
      if (!lead.phone || !lead.name) return null;
      const status = normalized(lead.status || "")
        .replace(/[- ]/g, "_")
        .toUpperCase();
      lead.status = ["OPT_IN", "OPT_OUT", "PENDING"].includes(status)
        ? status
        : status.includes("OUT")
          ? "OPT_OUT"
          : status.includes("PEND")
            ? "PENDING"
            : undefined;
      if (lead.category) lead.category = lead.category.split(/[,|]/)[0].trim();
      return lead;
    })
    .filter(Boolean);
}
