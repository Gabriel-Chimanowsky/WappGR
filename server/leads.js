const {
  id,
  text,
  fail,
  normalizePhone,
  utc,
  page,
  csv,
  validateSelection,
} = require("./domain");
const { consent } = require("./policy");
class Leads {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
  }
  where(filters = {}) {
    validateSelection({ filters });
    const clauses = [],
      params = [];
    if (filters.categoryId) {
      clauses.push("l.category_id=?");
      params.push(filters.categoryId);
    } else if (filters.category && filters.category !== "TODOS") {
      clauses.push("c.name=?");
      params.push(filters.category);
    }
    if (filters.status && filters.status !== "TODOS") {
      if (!["OPT_IN", "OPT_OUT", "PENDING"].includes(filters.status))
        fail("Status inválido.");
      clauses.push("l.status=?");
      params.push(filters.status);
    }
    if (filters.search) {
      const q = "%" + text(filters.search, "Busca", 200) + "%";
      clauses.push("(l.name LIKE ? OR l.phone LIKE ? OR l.notes LIKE ?)");
      params.push(q, q, q);
    }
    return {
      sql: clauses.length ? " WHERE " + clauses.join(" AND ") : "",
      params,
    };
  }
  list(query = {}) {
    const { sql, params } = this.where(query),
      { page: p, limit } = page(query);
    const from = " FROM leads l LEFT JOIN categories c ON c.id=l.category_id";
    const total = this.db
      .prepare("SELECT COUNT(*) n" + from + sql)
      .get(...params).n;
    return {
      leads: this.db
        .prepare(
          "SELECT l.*,c.name category,c.name category_name,c.color category_color" +
            from +
            sql +
            " ORDER BY l.created_at DESC,l.id LIMIT ? OFFSET ?",
        )
        .all(...params, limit, (p - 1) * limit),
      pagination: {
        page: p,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  selected(selection = {}) {
    validateSelection(selection);
    let rows;
    if (selection.type === "ids") {
      if (!Array.isArray(selection.ids) || selection.ids.length > 100000)
        fail("Seleção inválida.");
      const q = this.db.prepare(
        "SELECT l.*,c.name category_name FROM leads l LEFT JOIN categories c ON c.id=l.category_id WHERE l.id=?",
      );
      rows = [...new Set(selection.ids)].map((x) => q.get(x)).filter(Boolean);
    } else {
      const { sql, params } = this.where(selection.filters || selection);
      rows = this.db
        .prepare(
          "SELECT l.*,c.name category_name FROM leads l LEFT JOIN categories c ON c.id=l.category_id" +
            sql +
            " ORDER BY l.created_at,l.id",
        )
        .all(...params);
    }
    if (rows.length > 100000) fail("Máximo de 100.000 registros por operação.");
    const excluded = new Set(selection.excludedIds || []);
    return rows.filter((x) => !excluded.has(x.id));
  }
  get(leadId) {
    const l = this.db
      .prepare(
        "SELECT l.*,c.name category_name FROM leads l LEFT JOIN categories c ON c.id=l.category_id WHERE l.id=?",
      )
      .get(leadId);
    if (!l) fail("Contato não encontrado.", 404);
    return l;
  }
  category(body) {
    if (body.categoryId !== undefined) {
      if (
        body.categoryId &&
        !this.db
          .prepare("SELECT id FROM categories WHERE id=?")
          .get(body.categoryId)
      )
        fail("Categoria inexistente.");
      return body.categoryId || null;
    }
    if (!body.category || body.category === "TODOS") return null;
    const name = text(body.category, "Categoria", 120);
    let row = this.db
      .prepare("SELECT id FROM categories WHERE name=?")
      .get(name);
    if (!row) {
      row = { id: id() };
      this.db
        .prepare("INSERT INTO categories(id,name) VALUES(?,?)")
        .run(row.id, name);
    }
    return row.id;
  }
  create(body, actor = "admin", source = "MANUAL") {
    return this.db.transaction(() => {
      const phone = normalizePhone(body.phone);
      if (!phone)
        fail(
          "Telefone inválido; informe DDI com + para números internacionais.",
        );
      if (this.db.prepare("SELECT id FROM leads WHERE phone=?").get(phone))
        fail("Telefone já cadastrado.", 409);
      const leadId = id(),
        at = utc(this.now());
      this.db
        .prepare(
          "INSERT INTO leads(id,name,phone,category_id,notes,status,created_at) VALUES(?,?,?,?,?,'PENDING',?)",
        )
        .run(
          leadId,
          text(body.name, "Nome", 200),
          phone,
          this.category(body),
          String(body.notes || "").slice(0, 10000),
          at,
        );
      if (body.status && body.status !== "PENDING")
        consent(
          this.db,
          leadId,
          body.status,
          {
            source,
            reason: body.consentReason,
            actor,
            evidence: body.consentEvidence === true,
          },
          this.now(),
        );
      else
        consent(
          this.db,
          leadId,
          "PENDING",
          { source, reason: "Cadastro sem comprovação de autorização", actor },
          this.now(),
        );
      return this.get(leadId);
    })();
  }
  update(leadId, body, actor = "admin") {
    return this.db.transaction(() => {
      const old = this.get(leadId);
      const phone =
        body.phone === undefined ? old.phone : normalizePhone(body.phone);
      if (!phone) fail("Telefone inválido.");
      const changedIdentity = phone !== old.phone;
      if (
        changedIdentity &&
        old.status === "OPT_OUT" &&
        body.status === "OPT_IN" &&
        body.reconfirm !== true
      )
        fail(
          "Uma recusa anterior exige reconfirmação explícita.",
          409,
          "CONSENT_REQUIRED",
        );
      const cat =
        body.categoryId === undefined && body.category === undefined
          ? old.category_id
          : this.category(body);
      this.db
        .prepare(
          "UPDATE leads SET name=?,phone=?,jid=?,category_id=?,notes=? WHERE id=?",
        )
        .run(
          body.name === undefined ? old.name : text(body.name, "Nome", 200),
          phone,
          phone === old.phone ? old.jid : null,
          cat,
          body.notes === undefined
            ? old.notes
            : String(body.notes).slice(0, 10000),
          leadId,
        );
      if (changedIdentity) {
        this.db
          .prepare("UPDATE leads SET last_inbound_at=NULL WHERE id=?")
          .run(leadId);
        this.db
          .prepare("DELETE FROM lead_flow_sessions WHERE lead_id=?")
          .run(leadId);
        consent(
          this.db,
          leadId,
          "PENDING",
          {
            source: "IDENTITY_CHANGE",
            reason:
              "Telefone alterado; autorização e janela anteriores não se transferem",
            actor,
          },
          this.now(),
        );
      }
      if (
        body.status &&
        (body.status !== old.status || changedIdentity) &&
        body.status !== (changedIdentity ? "PENDING" : old.status)
      )
        consent(
          this.db,
          leadId,
          body.status,
          {
            source: "MANUAL",
            reason: body.consentReason,
            actor,
            evidence: body.consentEvidence === true,
            reconfirm: body.reconfirm === true,
          },
          this.now(),
        );
      return this.get(leadId);
    })();
  }
  import(body, actor) {
    if (
      !Array.isArray(body.leads) ||
      !body.leads.length ||
      body.leads.length > 100000
    )
      fail("Envie de 1 a 100.000 contatos.");
    return this.db.transaction(() => {
      let imported = 0,
        updated = 0,
        skipped = 0,
        consentPreserved = 0;
      for (const row of body.leads) {
        const phone = normalizePhone(row.phone);
        if (!phone || !String(row.name || "").trim()) {
          skipped++;
          continue;
        }
        const old = this.db
          .prepare("SELECT * FROM leads WHERE phone=?")
          .get(phone);
        if (old && body.updateExisting !== true) {
          skipped++;
          continue;
        }
        const requested =
          row.status || body.status || body.consentStatus || "PENDING";
        const status = ["OPT_IN", "OPT_OUT", "PENDING"].includes(requested)
          ? requested
          : "PENDING";
        const data = {
          ...row,
          phone: "+" + phone,
          categoryId: body.categoryId || row.categoryId,
          category: body.category || row.category,
          consentReason: body.consentReason,
          consentEvidence: body.consentEvidence === true,
        };
        if (old) {
          // Imports cannot grant or restore consent to an existing contact. Explicit opt-out is honored.
          this.update(
            old.id,
            {
              name: row.name,
              notes: row.notes === undefined ? old.notes : row.notes,
              ...(data.categoryId || data.category
                ? { categoryId: data.categoryId, category: data.category }
                : {}),
            },
            actor,
          );
          if (status === "OPT_OUT" && old.status !== "OPT_OUT")
            consent(
              this.db,
              old.id,
              "OPT_OUT",
              {
                source: "IMPORT",
                reason: "Descadastro informado no arquivo",
                actor,
              },
              this.now(),
            );
          else if (status !== old.status) consentPreserved++;
          updated++;
        } else {
          data.status =
            status === "OPT_IN" &&
            !(body.consentEvidence === true && body.consentReason)
              ? "PENDING"
              : status;
          if (data.status !== status) consentPreserved++;
          if (data.status === "OPT_OUT")
            data.consentReason = "Descadastro informado no arquivo";
          this.create(data, actor, "IMPORT");
          imported++;
        }
      }
      return { imported, updated, skipped, consentPreserved };
    })();
  }
  export(selection) {
    return csv(this.selected(selection), [
      { key: "id", label: "ID" },
      { key: "name", label: "Nome" },
      { key: "phone", label: "Telefone" },
      { key: "category_name", label: "Categoria" },
      { key: "status", label: "Status de Consentimento" },
      { key: "consent_method", label: "Método de Consentimento" },
      { key: "consent_timestamp", label: "Data de Consentimento" },
      { key: "messages_sent_count", label: "Envios Realizados" },
      { key: "notes", label: "Observações" },
      { key: "created_at", label: "Data de Cadastro" },
    ]);
  }
}
module.exports = { Leads };
