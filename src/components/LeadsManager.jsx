import { useEffect, useState } from "react";
import { api, mutation, download } from "../lib/api";
import { parseLeads } from "../../shared/csv.mjs";
import { Field, Pager, Status } from "./QueueUI";
const empty = {
  name: "",
  phone: "",
  categoryId: "",
  status: "PENDING",
  notes: "",
  consentReason: "",
  consentEvidence: false,
  reconfirm: false,
};
export default function LeadsManager({
  categories = [],
  onCreateCampaign,
  onRefresh,
}) {
  const [filters, setFilters] = useState({
      search: "",
      status: "",
      categoryId: "",
    }),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(50),
    [data, setData] = useState(null),
    [selection, setSelection] = useState({ type: "ids", ids: [] }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState(null),
    [bulkEdit, setBulkEdit] = useState(null),
    [importText, setImportText] = useState(""),
    [parsed, setParsed] = useState([]),
    [importConfig, setImportConfig] = useState({
      updateExisting: false,
      categoryId: "",
      consentEvidence: false,
      consentReason: "",
    }),
    [importOpen, setImportOpen] = useState(false),
    [categoryForm, setCategoryForm] = useState(null),
    [repair, setRepair] = useState(null);
  const params = new URLSearchParams({ ...filters, page, limit }).toString();
  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () =>
        api("/leads?" + params)
          .then((x) => {
            if (alive) setData(x);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [params]);
  const reload = async () => {
    setData(await api("/leads?" + params));
    await onRefresh?.();
  };
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const updateFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelection({ type: "ids", ids: [] });
  };
  const chosen = (id) =>
    selection.type === "filters"
      ? !selection.excludedIds.includes(id)
      : selection.ids.includes(id);
  const toggle = (id, on) =>
    setSelection((s) =>
      s.type === "filters"
        ? {
            ...s,
            excludedIds: on
              ? s.excludedIds.filter((x) => x !== id)
              : [...s.excludedIds, id],
          }
        : {
            ...s,
            ids: on
              ? [...new Set([...s.ids, id])]
              : s.ids.filter((x) => x !== id),
          },
    );
  const count =
    selection.type === "ids"
      ? selection.ids.length
      : Math.max(
          0,
          (data?.pagination.total || 0) - selection.excludedIds.length,
        );
  const parse = (value) => {
    setImportText(value);
    try {
      setParsed(parseLeads(value));
      setError("");
    } catch (e) {
      setParsed([]);
      setError(e.message);
    }
  };
  const categoryOptions = (
    <>
      <option value="">Sem categoria</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );
  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads e categorias</h1>
          <p className="text-slate-400">
            Busca e seleção consultam toda a base no servidor.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setImportOpen((v) => !v)}>
            Importar CSV/TXT
          </button>
          <button className="btn primary" onClick={() => setForm({ ...empty })}>
            Novo contato
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="panel space-y-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Buscar contatos">
            <input
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
            />
          </Field>
          <Field label="Consentimento">
            <select
              value={filters.status}
              onChange={(e) => updateFilter("status", e.target.value)}
            >
              <option value="">Todos</option>
              {["OPT_IN", "OPT_OUT", "PENDING"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select
              value={filters.categoryId}
              onChange={(e) => updateFilter("categoryId", e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Por página">
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
            >
              {[50, 100, 250, 500].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              setSelection({
                type: "filters",
                filters: { ...filters },
                excludedIds: [],
              })
            }
          >
            Selecionar todos os {data?.pagination.total || 0} resultados
          </button>
          <button
            className="btn"
            onClick={() =>
              setSelection({
                type: "ids",
                ids: [
                  ...new Set([
                    ...(selection.ids || []),
                    ...(data?.leads.map((x) => x.id) || []),
                  ]),
                ],
              })
            }
          >
            Selecionar página
          </button>
          <button
            className="btn"
            onClick={() => setSelection({ type: "ids", ids: [] })}
          >
            Limpar seleção
          </button>
          <button
            className="btn primary"
            disabled={!count || busy}
            onClick={() => onCreateCampaign(selection)}
          >
            Criar campanha com {count} selecionados
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Desmarque linhas para excluí-las da seleção geral. Alterar filtros
          limpa a seleção. Contatos sem opt-in serão excluídos na prévia da
          campanha.
        </p>
        <div className="overflow-auto max-h-[620px]">
          <table className="data-table">
            <thead>
              <tr>
                <th>Selecionar</th>
                <th>Contato</th>
                <th>Categoria</th>
                <th>Consentimento</th>
                <th>Envios aceitos</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"Selecionar " + l.name}
                      checked={chosen(l.id)}
                      onChange={(e) => toggle(l.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    {l.name}
                    <small className="block text-slate-400">
                      {l.phone.startsWith("lid:")
                        ? "Identificador WhatsApp sem telefone confirmado"
                        : l.phone}
                    </small>
                  </td>
                  <td>{l.category_name || "Sem categoria"}</td>
                  <td>
                    <Status value={l.status} />
                    <small className="block text-slate-400">
                      {l.consent_method}
                    </small>
                  </td>
                  <td>
                    {l.messages_sent_count}
                    {l.legacy_messages_sent_count > 0 && (
                      <small className="block text-slate-400">
                        Contagem anterior à migração:{" "}
                        {l.legacy_messages_sent_count}
                      </small>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn"
                      onClick={() =>
                        setForm({
                          ...empty,
                          ...l,
                          phone: l.phone.startsWith("lid:")
                            ? ""
                            : "+" + l.phone,
                          categoryId: l.category_id || "",
                        })
                      }
                    >
                      Editar
                    </button>{" "}
                    <button
                      className="btn danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Excluir este contato? O histórico de mensagens será preservado.",
                          )
                        )
                          act(() => mutation("/leads/" + l.id, {}, "DELETE"));
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager pagination={data?.pagination} onChange={setPage} busy={busy} />
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(() =>
                download("/leads/export", "leads_wappgr.csv", {
                  selection: count ? selection : { type: "filters", filters },
                }),
              )
            }
          >
            Exportar {count ? "seleção" : "filtro"}
          </button>
          <button
            className="btn"
            disabled={!count || busy}
            onClick={() => setBulkEdit({ kind: "category", categoryId: "" })}
          >
            Categoria em lote
          </button>
          <button
            className="btn"
            disabled={!count || busy}
            onClick={() => {
              if (confirm("Registrar opt-out dos " + count + " selecionados?"))
                act(() =>
                  mutation("/leads/bulk-update", {
                    selection,
                    updates: {
                      status: "OPT_OUT",
                      consentReason: "Descadastro manual em lote",
                    },
                  }),
                );
            }}
          >
            Registrar opt-out
          </button>
          <button
            className="btn"
            disabled={!count || busy}
            onClick={() =>
              setBulkEdit({
                kind: "consent",
                consentReason: "",
                consentEvidence: false,
                reconfirm: false,
              })
            }
          >
            Registrar opt-in com evidência
          </button>
          <button
            className="btn danger"
            disabled={!count || busy}
            onClick={() => {
              if (confirm("Excluir " + count + " contatos?"))
                act(async () => {
                  await mutation("/leads/bulk-delete", { selection });
                  setSelection({ type: "ids", ids: [] });
                });
            }}
          >
            Excluir seleção
          </button>
        </div>
      </div>
      {bulkEdit && (
        <form
          className="panel space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const updates =
                bulkEdit.kind === "category"
                  ? { categoryId: bulkEdit.categoryId }
                  : {
                      status: "OPT_IN",
                      consentReason: bulkEdit.consentReason,
                      consentEvidence: bulkEdit.consentEvidence,
                      reconfirm: bulkEdit.reconfirm,
                    };
              await mutation("/leads/bulk-update", { selection, updates });
              setBulkEdit(null);
              setNotice("Alteração aplicada a " + count + " contatos.");
            });
          }}
        >
          <h2 className="font-bold">Alterar {count} contatos selecionados</h2>
          {bulkEdit.kind === "category" ? (
            <Field label="Categoria de destino">
              <select
                value={bulkEdit.categoryId}
                onChange={(e) =>
                  setBulkEdit({ ...bulkEdit, categoryId: e.target.value })
                }
              >
                {categoryOptions}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Origem e motivo da autorização">
                <input
                  required
                  value={bulkEdit.consentReason}
                  onChange={(e) =>
                    setBulkEdit({ ...bulkEdit, consentReason: e.target.value })
                  }
                />
              </Field>
              <label className="block">
                <input
                  type="checkbox"
                  required
                  checked={bulkEdit.consentEvidence}
                  onChange={(e) =>
                    setBulkEdit({
                      ...bulkEdit,
                      consentEvidence: e.target.checked,
                    })
                  }
                />{" "}
                Tenho evidência explícita para cada contato desta seleção
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={bulkEdit.reconfirm}
                  onChange={(e) =>
                    setBulkEdit({ ...bulkEdit, reconfirm: e.target.checked })
                  }
                />{" "}
                Houve nova autorização explícita dos contatos que haviam
                recusado
              </label>
            </>
          )}
          <button className="btn primary" disabled={busy || !count}>
            Aplicar à seleção
          </button>{" "}
          <button
            type="button"
            className="btn"
            onClick={() => setBulkEdit(null)}
          >
            Fechar
          </button>
        </form>
      )}
      {form && (
        <form
          className="panel space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await mutation(
                "/leads" + (form.id ? "/" + form.id : ""),
                form,
                form.id ? "PATCH" : "POST",
              );
              setForm(null);
              setNotice("Contato salvo.");
            });
          }}
        >
          <h2 className="text-lg font-bold">
            {form.id ? "Editar contato" : "Novo contato"}
          </h2>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Nome">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Telefone (DDI com +)">
              <input
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Categoria do contato">
              <select
                value={form.categoryId}
                onChange={(e) =>
                  setForm({ ...form, categoryId: e.target.value })
                }
              >
                {categoryOptions}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {["PENDING", "OPT_IN", "OPT_OUT"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Motivo / evidência do consentimento">
              <input
                value={form.consentReason}
                onChange={(e) =>
                  setForm({ ...form, consentReason: e.target.value })
                }
                required={form.status === "OPT_IN"}
              />
            </Field>
          </div>
          <Field label="Observações">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          {form.status === "OPT_IN" && (
            <>
              <label className="block">
                <input
                  type="checkbox"
                  checked={form.consentEvidence}
                  onChange={(e) =>
                    setForm({ ...form, consentEvidence: e.target.checked })
                  }
                />{" "}
                Tenho evidência de autorização explícita
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={form.reconfirm}
                  onChange={(e) =>
                    setForm({ ...form, reconfirm: e.target.checked })
                  }
                />{" "}
                Se houve opt-out, recebi uma nova autorização explícita
              </label>
            </>
          )}
          <button className="btn primary" disabled={busy}>
            Salvar contato
          </button>{" "}
          <button type="button" className="btn" onClick={() => setForm(null)}>
            Fechar
          </button>
        </form>
      )}
      {importOpen && (
        <form
          className="panel space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const r = await mutation("/leads/import", {
                ...importConfig,
                leads: parsed,
              });
              setNotice(
                r.imported +
                  " novos, " +
                  r.updated +
                  " atualizados, " +
                  r.skipped +
                  " ignorados; " +
                  r.consentPreserved +
                  " classificações preservadas ou mantidas pendentes.",
              );
              setImportText("");
              setParsed([]);
            });
          }}
        >
          <h2 className="font-bold">Importação CSV/TXT ou texto de planilha</h2>
          <p className="notice">
            Para Excel, exporte a aba como CSV UTF-8 ou cole as células.
            Arquivos XLS/XLSX não são lidos diretamente. Consentimento por linha
            é preservado; contatos existentes nunca recebem opt-in por
            reimportação.
          </p>
          <input
            aria-label="Arquivo CSV ou TXT"
            type="file"
            accept=".csv,.txt"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (file.size > 10000000) {
                setError("Máximo de 10 MB.");
                return;
              }
              parse(await file.text());
            }}
          />
          <Field label="Dados para importar">
            <textarea
              value={importText}
              onChange={(e) => parse(e.target.value)}
              placeholder={
                "Nome;Telefone;Status de Consentimento\nExemplo;11999999999;PENDING"
              }
            />
          </Field>
          <p>{parsed.length} contatos reconhecidos</p>
          <div className="text-xs">
            {parsed.slice(0, 5).map((l, i) => (
              <p key={i}>
                {l.name} · {l.phone} · {l.status || "PENDING"} · {l.category}
              </p>
            ))}
          </div>
          <Field label="Categoria fixa (vazio usa a planilha)">
            <select
              value={importConfig.categoryId}
              onChange={(e) =>
                setImportConfig({ ...importConfig, categoryId: e.target.value })
              }
            >
              {categoryOptions}
            </select>
          </Field>
          <label className="block">
            <input
              type="checkbox"
              checked={importConfig.updateExisting}
              onChange={(e) =>
                setImportConfig({
                  ...importConfig,
                  updateExisting: e.target.checked,
                })
              }
            />{" "}
            Atualizar nome e notas de contatos existentes
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={importConfig.consentEvidence}
              onChange={(e) =>
                setImportConfig({
                  ...importConfig,
                  consentEvidence: e.target.checked,
                })
              }
            />{" "}
            Tenho evidência para os novos contatos marcados OPT_IN no arquivo
          </label>
          {importConfig.consentEvidence && (
            <Field label="Origem e descrição da evidência">
              <input
                required
                value={importConfig.consentReason}
                onChange={(e) =>
                  setImportConfig({
                    ...importConfig,
                    consentReason: e.target.value,
                  })
                }
              />
            </Field>
          )}
          <button className="btn primary" disabled={busy || !parsed.length}>
            Importar {parsed.length} contatos
          </button>
        </form>
      )}
      <details className="panel">
        <summary className="font-bold cursor-pointer">
          Gerenciar categorias ({categories.length})
        </summary>
        <div className="space-y-3 mt-4">
          <button
            className="btn"
            onClick={() =>
              setCategoryForm({ name: "", color: "#10b981", description: "" })
            }
          >
            Nova categoria
          </button>{" "}
          <button
            className="btn"
            onClick={() =>
              act(async () =>
                setRepair({
                  kind: "empty",
                  rows: await api("/categories/repair-preview?kind=empty"),
                }),
              )
            }
          >
            Prévia de categorias vazias
          </button>{" "}
          <button
            className="btn"
            onClick={() =>
              act(async () =>
                setRepair({
                  kind: "corrupted",
                  rows: await api("/categories/repair-preview?kind=corrupted"),
                }),
              )
            }
          >
            Prévia de reparo
          </button>
          {repair && (
            <div className="notice">
              <p>
                {repair.rows.length} categorias elegíveis:{" "}
                {repair.rows.map((x) => x.name).join(", ") || "nenhuma"}.
                Referências em fluxos e regras são preservadas.
              </p>
              <button
                className="btn danger mt-2"
                disabled={!repair.rows.length || busy}
                onClick={() => {
                  if (
                    confirm(
                      "Remover somente as categorias desta prévia? Contatos ficarão sem categoria.",
                    )
                  )
                    act(async () => {
                      await mutation("/categories/cleanup-" + repair.kind, {
                        ids: repair.rows.map((x) => x.id),
                      });
                      setRepair(null);
                    });
                }}
              >
                Confirmar remoção da prévia
              </button>
            </div>
          )}
          {categories.map((c) => (
            <div key={c.id} className="flex gap-3 items-center">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="flex-1">
                {c.name} ({c.lead_count})
              </span>
              <button className="btn" onClick={() => setCategoryForm(c)}>
                Editar
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Excluir categoria " + c.name + "?"))
                    act(() => mutation("/categories/" + c.id, {}, "DELETE"));
                }}
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
      </details>
      {categoryForm && (
        <form
          className="panel space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await mutation(
                "/categories" + (categoryForm.id ? "/" + categoryForm.id : ""),
                categoryForm,
                categoryForm.id ? "PATCH" : "POST",
              );
              setCategoryForm(null);
            });
          }}
        >
          <Field label="Nome da categoria">
            <input
              required
              value={categoryForm.name}
              onChange={(e) =>
                setCategoryForm({ ...categoryForm, name: e.target.value })
              }
            />
          </Field>
          <Field label="Cor">
            <input
              type="color"
              value={categoryForm.color}
              onChange={(e) =>
                setCategoryForm({ ...categoryForm, color: e.target.value })
              }
            />
          </Field>
          <Field label="Descrição">
            <input
              value={categoryForm.description}
              onChange={(e) =>
                setCategoryForm({
                  ...categoryForm,
                  description: e.target.value,
                })
              }
            />
          </Field>
          <button className="btn primary" disabled={busy}>
            Salvar categoria
          </button>{" "}
          <button
            className="btn"
            type="button"
            onClick={() => setCategoryForm(null)}
          >
            Fechar
          </button>
        </form>
      )}
    </div>
  );
}
