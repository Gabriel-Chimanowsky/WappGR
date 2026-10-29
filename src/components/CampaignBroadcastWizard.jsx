import { dateLabel } from "../lib/presentation";
import { useState, useEffect, useRef } from "react";
import { Send, Pause, Play, Download, RefreshCw } from "lucide-react";
import { api, mutation, download } from "../lib/api";
import { randomUUID } from "../lib/uuid";
import { Field, Status, Pager } from "./QueueUI";
const initial = {
  title: "",
  message: "",
  batchSize: 40,
  batchIntervalSeconds: 7200,
  pacingSeconds: 10,
  maxAttempts: 3,
  mode: "AUTO",
  startMode: "IMMEDIATE",
  timezone: "America/Sao_Paulo",
  startLocal: "",
};
export default function CampaignBroadcastWizard({
  categories = [],
  selection: externalSelection,
  onClearSelection,
  connection,
}) {
  const [form, setForm] = useState(initial),
    [categoryId, setCategory] = useState(""),
    [preview, setPreview] = useState(null),
    [campaigns, setCampaigns] = useState([]),
    [currentId, setCurrentId] = useState(null),
    [current, setCurrent] = useState(null),
    [recipients, setRecipients] = useState(null),
    [events, setEvents] = useState([]),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState(""),
    [checked, setChecked] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [clock, setClock] = useState(() => Date.now());
  const createRequest = useRef(null),
    actionRequest = useRef(null),
    offset = useRef(0);
  const selection = externalSelection || {
    type: "filters",
    filters: { categoryId },
  };
  const selectionKey = JSON.stringify(selection);
  const change = (name, value) => setForm((f) => ({ ...f, [name]: value }));
  useEffect(() => {
    let alive = true;
    api("/campaigns/preview", {
      method: "POST",
      body: JSON.stringify({ selection: JSON.parse(selectionKey) }),
    })
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [selectionKey]);
  useEffect(() => {
    let alive = true,
      timer;
    async function poll() {
      try {
        const list = await api("/campaigns");
        if (alive) setCampaigns(list);
        if (currentId) {
          const [c, r, e] = await Promise.all([
            api("/campaigns/" + currentId),
            api(
              "/campaigns/" +
                currentId +
                "/recipients?page=" +
                page +
                "&status=" +
                filter,
            ),
            api("/campaigns/" + currentId + "/events"),
          ]);
          if (alive) {
            offset.current = Date.parse(c.serverNow) - Date.now();
            setCurrent(c);
            setRecipients(r);
            setEvents(e);
          }
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [currentId, page, filter]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now() + offset.current), 1000);
    return () => clearInterval(t);
  }, []);
  const refresh = async () => {
    setCampaigns(await api("/campaigns"));
    if (currentId) {
      setCurrent(await api("/campaigns/" + currentId));
      setRecipients(
        await api(
          "/campaigns/" +
            currentId +
            "/recipients?page=" +
            page +
            "&status=" +
            filter,
        ),
      );
      setEvents(await api("/campaigns/" + currentId + "/events"));
    }
  };
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { ...form, selection },
        encoded = JSON.stringify(body);
      if (createRequest.current?.encoded !== encoded)
        createRequest.current = { encoded, key: randomUUID() };
      const result = await mutation(
        "/campaigns/send",
        body,
        "POST",
        createRequest.current.key,
      );
      setCurrentId(result.campaign.id);
      setCurrent(result.campaign);
      setPage(1);
      setNotice(result.message);
      setForm(initial);
      createRequest.current = null;
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function control(action, body = {}) {
    if (
      action === "cancel" &&
      !confirm("Cancelar os envios restantes? O histórico será preservado.")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const encoded = JSON.stringify({ id: currentId, action, body });
      if (actionRequest.current?.encoded !== encoded)
        actionRequest.current = { encoded, key: randomUUID() };
      const result = await mutation(
        "/campaigns/" + currentId + "/" + action,
        body,
        "POST",
        actionRequest.current.key,
      );
      setCurrent(result);
      actionRequest.current = null;
      setChecked([]);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const estimatedBatches = preview
    ? Math.ceil(preview.eligible / Math.max(1, Number(form.batchSize)))
    : 0;
  const estimate = preview
    ? Math.max(
        0,
        (estimatedBatches - 1) * Number(form.batchIntervalSeconds) +
          Math.max(0, preview.eligible - 1) *
            Math.max(2, Number(form.pacingSeconds)),
      )
    : 0;
  const remaining = current?.next_run_at
    ? Math.max(0, Math.ceil((Date.parse(current.next_run_at) - clock) / 1000))
    : 0;
  const finished =
    current &&
    ["COMPLETED", "COMPLETED_WITH_FAILURES", "CANCELLED", "LEGACY"].includes(
      current.execution_status,
    );
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold flex gap-2 items-center">
          <Send className="text-emerald-400" />
          Campanhas em lotes
        </h1>
        <p className="text-slate-400 mt-2">
          Progresso salvo no servidor. Fechar o navegador não interrompe uma
          execução automática.
        </p>
      </header>
      <p className="notice">
        Conexão: <Status value={connection?.status || "DISCONNECTED"} /> · Lotes
        e cadência controlam a operação; não garantem ausência de bloqueios.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <details className="panel" open={!currentId}>
        <summary className="font-bold cursor-pointer">Criar campanha</summary>
        <form className="space-y-5 mt-5" onSubmit={create}>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Título">
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
              />
            </Field>
            {externalSelection ? (
              <div className="notice">
                Seleção da tela de leads:{" "}
                {externalSelection.type === "ids"
                  ? externalSelection.ids.length + " contatos individuais"
                  : "todos os resultados do filtro"}{" "}
                · {externalSelection.excludedIds?.length || 0} exclusões.
                <button
                  type="button"
                  className="btn mt-2"
                  onClick={onClearSelection}
                >
                  Usar categoria
                </button>
              </div>
            ) : (
              <Field label="Audiência por categoria">
                <select
                  value={categoryId}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <div className="notice">
            {preview ? (
              <>
                <strong>{preview.selected}</strong> selecionados ·{" "}
                <strong className="text-emerald-400">
                  {preview.eligible} elegíveis
                </strong>{" "}
                · {preview.excluded} excluídos
                <div className="text-xs mt-2">
                  Sem opt-in: {preview.reasons.notOptedIn} · Identidade
                  inválida: {preview.reasons.invalidIdentity} · Exclusão manual:{" "}
                  {preview.reasons.excludedByOperator} · Duplicados:{" "}
                  {preview.reasons.duplicate} · Ausentes:{" "}
                  {preview.reasons.missing}
                </div>
              </>
            ) : (
              "Calculando audiência no servidor…"
            )}
          </div>
          <Field label="Mensagem (texto)">
            <textarea
              required
              maxLength={10000}
              value={form.message}
              onChange={(e) => change("message", e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            {["{nome}", "{categoria}", "{telefone}"].map((v) => (
              <button
                type="button"
                className="btn"
                key={v}
                onClick={() => change("message", form.message + v)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Tentativas por lote (1–200)">
              <input
                type="number"
                min="1"
                max="200"
                required
                value={form.batchSize}
                onChange={(e) => change("batchSize", Number(e.target.value))}
              />
            </Field>
            <Field label="Intervalo entre lotes (segundos)">
              <input
                type="number"
                min="60"
                max="604800"
                required
                value={form.batchIntervalSeconds}
                onChange={(e) =>
                  change("batchIntervalSeconds", Number(e.target.value))
                }
              />
              <small>7.200 segundos = duas horas</small>
            </Field>
            <Field label="Entre mensagens (segundos)">
              <input
                type="number"
                min="1"
                max="300"
                required
                value={form.pacingSeconds}
                onChange={(e) =>
                  change("pacingSeconds", Number(e.target.value))
                }
              />
              <small>Mínimo global efetivo: 2 segundos</small>
            </Field>
            <Field label="Tentativas automáticas por contato">
              <input
                type="number"
                min="1"
                max="5"
                value={form.maxAttempts}
                onChange={(e) => change("maxAttempts", Number(e.target.value))}
              />
            </Field>
            <Field label="Modo">
              <select
                value={form.mode}
                onChange={(e) => change("mode", e.target.value)}
              >
                <option value="AUTO">Automático</option>
                <option value="MANUAL">Autorizar cada próximo lote</option>
              </select>
            </Field>
            <Field label="Início">
              <select
                value={form.startMode}
                onChange={(e) => change("startMode", e.target.value)}
              >
                <option value="IMMEDIATE">
                  Assim que as condições permitirem
                </option>
                <option value="SCHEDULED">Agendado</option>
                <option value="DRAFT">Salvar rascunho</option>
              </select>
            </Field>
            <Field label="Fuso horário">
              <input
                required
                value={form.timezone}
                onChange={(e) => change("timezone", e.target.value)}
              />
            </Field>
            {form.startMode === "SCHEDULED" && (
              <Field label="Data e hora no fuso informado">
                <input
                  type="datetime-local"
                  required
                  value={form.startLocal}
                  onChange={(e) => change("startLocal", e.target.value)}
                />
              </Field>
            )}
          </div>
          <p className="notice">
            Estimativa sem falhas: {estimatedBatches} lotes,{" "}
            {Math.max(0, estimatedBatches - 1)} intervalos, aproximadamente{" "}
            {(estimate / 3600).toFixed(1)} horas. A estimativa não inclui
            latência, outras filas, desconexões nem espera por autorização.
            Retries consomem vagas do lote. A lista e o texto ficam congelados
            ao salvar.
          </p>
          <button className="btn primary" disabled={busy || !preview?.eligible}>
            {busy ? "Salvando…" : "Salvar campanha"}
          </button>
        </form>
      </details>
      <div className="grid lg:grid-cols-[270px_1fr] gap-5">
        <aside className="panel space-y-3">
          <h2 className="font-bold">Campanhas recentes</h2>
          <button
            className="btn w-full"
            onClick={() => {
              setCurrentId(null);
              setCurrent(null);
            }}
          >
            Nova campanha
          </button>
          {campaigns.map((c) => (
            <button
              className={
                "w-full text-left rounded-lg p-3 border " +
                (c.id === currentId
                  ? "border-emerald-500 bg-emerald-950/30"
                  : "border-slate-700")
              }
              key={c.id}
              onClick={() => {
                setCurrentId(c.id);
                setCurrent(c);
                setPage(1);
                setChecked([]);
              }}
            >
              <strong className="block mb-2">{c.title}</strong>
              <Status value={c.execution_status} />
              <p className="text-xs mt-2 text-slate-400">
                {c.legacy
                  ? "Dados individuais indisponíveis"
                  : c.sent + " / " + c.total_target + " enviados"}
              </p>
            </button>
          ))}
        </aside>
        {current ? (
          <section className="panel space-y-5 min-w-0">
            <header className="flex justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold">{current.title}</h2>
                <Status value={current.execution_status} />
              </div>
              <button
                className="btn"
                aria-label="Atualizar campanha"
                onClick={() => refresh().catch((e) => setError(e.message))}
              >
                <RefreshCw size={16} />
              </button>
            </header>
            {current.legacy ? (
              <p className="notice">
                Campanha antiga preservada. Não há registros individuais
                suficientes para retomada ou confirmação de entrega.
              </p>
            ) : (
              <>
                {current.reason && <p className="notice">{current.reason}</p>}
                <progress
                  className="w-full accent-emerald-500"
                  max={current.total_target || 1}
                  value={current.total_target - current.pending}
                />
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    ["Previstos", current.total_target],
                    ["Aceitos pelo provedor", current.sent],
                    ["Entregues", current.delivered],
                    ["Lidos", current.read],
                    ["Pendentes", current.pending],
                    ["Falhas", current.counts.FAILED || 0],
                    ["Ignorados", current.counts.SKIPPED || 0],
                    ["Incertos", current.counts.UNCERTAIN || 0],
                  ].map(([label, value]) => (
                    <div className="rounded-xl bg-slate-800 p-3" key={label}>
                      <p className="text-xs text-slate-400">{label}</p>
                      <strong className="text-xl">{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="notice space-y-2">
                  <p>
                    Lote {current.batch?.number || 0} ·{" "}
                    {current.batch?.attempts || 0} / {current.config.batchSize}{" "}
                    tentativas · saldo{" "}
                    {current.batch?.status === "OPEN"
                      ? current.config.batchSize - current.batch.attempts
                      : 0}{" "}
                    · total de tentativas: {current.attempts}
                  </p>
                  <p>
                    Próximo horário mínimo:{" "}
                    {dateLabel(current.next_run_at, current.config.timezone)} (
                    {current.config.timezone})
                    {remaining > 0
                      ? " · falta " +
                        Math.floor(remaining / 3600) +
                        "h " +
                        Math.floor((remaining % 3600) / 60) +
                        "min " +
                        (remaining % 60) +
                        "s"
                      : ""}
                  </p>
                  <p>
                    Retomar mantém o saldo e o horário mínimo. Autorizar um lote
                    não antecipa esse horário.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {current.execution_status === "DRAFT" && (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => control("start")}
                    >
                      Iniciar
                    </button>
                  )}
                  {!finished &&
                    current.execution_status !== "DRAFT" &&
                    !current.manual_paused &&
                    !current.cancel_requested && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => control("pause")}
                      >
                        <Pause size={14} className="inline mr-1" />
                        Pausar
                      </button>
                    )}
                  {!!current.manual_paused &&
                    !finished &&
                    !current.cancel_requested && (
                      <button
                        className="btn primary"
                        disabled={
                          busy ||
                          current.execution_status === "PAUSE_REQUESTED" ||
                          !!connection?.account?.restricted
                        }
                        onClick={() => control("resume")}
                      >
                        <Play size={14} className="inline mr-1" />
                        Continuar
                      </button>
                    )}
                  {!!current.awaiting_authorization &&
                    !current.manual_paused &&
                    !finished && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => control("authorize-next")}
                      >
                        Autorizar próximo lote
                      </button>
                    )}
                  {!finished && !current.cancel_requested && (
                    <button
                      className="btn danger"
                      disabled={busy}
                      onClick={() => control("cancel")}
                    >
                      Cancelar restantes
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() =>
                      download(
                        "/campaigns/" + current.id + "/export",
                        "campanha.csv",
                      ).catch((e) => setError(e.message))
                    }
                  >
                    <Download size={14} className="inline mr-1" />
                    Exportar relatório
                  </button>
                </div>
                {!!current.counts.UNCERTAIN && (
                  <p className="notice">
                    Resultado incerto: pode ter ocorrido envio antes da
                    interrupção. Estes registros não serão reenviados
                    automaticamente; recibos do provedor podem reconciliá-los.
                  </p>
                )}
                <div className="flex gap-3 items-end">
                  <Field label="Estado do destinatário">
                    <select
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                        setChecked([]);
                      }}
                    >
                      <option value="">Todos</option>
                      {[
                        "PENDING",
                        "SENT",
                        "DELIVERED",
                        "READ",
                        "FAILED",
                        "SKIPPED",
                        "UNCERTAIN",
                        "RETRY_WAIT",
                        "CANCELLED",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    className="btn"
                    disabled={busy || !checked.length}
                    onClick={() => control("retry", { recipientIds: checked })}
                  >
                    Reprocessar {checked.length} falhas elegíveis
                  </button>
                </div>
                <div className="overflow-auto max-h-[560px]">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Retry</th>
                        <th>Posição / contato</th>
                        <th>Estado</th>
                        <th>Tentativas</th>
                        <th>Erro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients?.rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <input
                              aria-label={
                                "Selecionar falha de " + r.name_snapshot
                              }
                              type="checkbox"
                              disabled={
                                r.status !== "FAILED" ||
                                !r.retryable ||
                                r.attempts >= 5
                              }
                              checked={checked.includes(r.id)}
                              onChange={(e) =>
                                setChecked((v) =>
                                  e.target.checked
                                    ? [...v, r.id]
                                    : v.filter((x) => x !== r.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            {r.position}. {r.name_snapshot}
                            <small className="block text-slate-400">
                              {r.phone_snapshot}
                            </small>
                          </td>
                          <td>
                            <Status value={r.status} />
                          </td>
                          <td>{r.attempts}</td>
                          <td className="max-w-xs break-words text-xs">
                            {r.error || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  pagination={recipients?.pagination}
                  onChange={setPage}
                  busy={busy}
                />
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Eventos recentes ({events.length})
                  </summary>
                  <div className="space-y-2 mt-3 max-h-72 overflow-auto">
                    {events.map((e) => (
                      <div
                        className="text-xs border-b border-slate-800 py-2"
                        key={e.id}
                      >
                        <strong>{e.kind}</strong> ·{" "}
                        {dateLabel(e.created_at, current.config.timezone)} ·{" "}
                        {e.actor}
                        <p className="break-all text-slate-400">
                          {JSON.stringify(e.details)}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </section>
        ) : (
          <div className="panel text-slate-400">
            Selecione uma campanha para acompanhar os lotes e destinatários.
          </div>
        )}
      </div>
    </div>
  );
}
