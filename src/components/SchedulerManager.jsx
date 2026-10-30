import { dateLabel } from "../lib/presentation";
import { useState, useEffect, useRef } from "react";
import { api, mutation } from "../lib/api";
import { randomUUID } from "../lib/uuid";
import { Field } from "./QueueUI";
import MessageConfig, { CostPreview, BudgetFields } from "./MessageConfig";
const initial = {
  title: "",
  message: "",
  categoryId: "",
  recurrence: "DAILY",
  timeOfDay: "09:00",
  startDate: "",
  timezone: "America/Sao_Paulo",
  specificDays: [],
  batchSize: 40,
  batchIntervalSeconds: 7200,
  pacingSeconds: 10,
  messageCategory: null,
  active: true,
};
export default function SchedulerManager({ categories = [], onOpenCampaign }) {
  const [rules, setRules] = useState([]),
    [editId, setEditId] = useState(null),
    [preview, setPreview] = useState(null),
    [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(null);
  const previewKey = JSON.stringify(form);
  useEffect(() => {
    let live = true;
    api("/campaigns/preview", { method: "POST", body: previewKey })
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch(() => {
        if (live) setPreview(null);
      });
    return () => {
      live = false;
    };
  }, [previewKey]);
  useEffect(() => {
    let live = true,
      timer;
    async function poll() {
      try {
        const d = await api("/schedules");
        if (live) setRules(d);
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) timer = setTimeout(poll, 5000);
      }
    }
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  const change = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setRules(await api("/schedules"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold">Agendamentos recorrentes</h1>
      <p className="notice">
        Cada ocorrência cria uma campanha em lotes. Desativar uma regra impede
        futuras ocorrências; pause uma execução existente na tela de campanhas.
        Ao reiniciar, recupera-se no máximo uma ocorrência vencida, sem acumular
        disparos. Uma execução anterior ainda aberta impede sobreposição.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="panel space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.active && !form.messageCategory) {
            setError("Selecione a Categoria da mensagem.");
            return;
          }
          act(async () => {
            const encoded = JSON.stringify(form);
            if (request.current?.encoded !== encoded)
              request.current = { encoded, key: randomUUID() };
            await mutation(
              editId ? "/schedules/" + editId : "/schedules",
              { ...form, previewToken: preview?.previewToken },
              editId ? "PATCH" : "POST",
              request.current.key,
            );
            request.current = null;
            setForm(initial);
            setEditId(null);
          });
        }}
      >
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Título da regra">
            <input
              required
              value={form.title}
              onChange={(e) => change("title", e.target.value)}
            />
          </Field>
          <Field label="Categoria">
            <select
              value={form.categoryId}
              onChange={(e) => change("categoryId", e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recorrência">
            <select
              value={form.recurrence}
              onChange={(e) => change("recurrence", e.target.value)}
            >
              <option value="DAILY">Diária</option>
              <option value="EVERY_OTHER_DAY">
                Dias alternados pelo calendário
              </option>
              <option value="SPECIFIC_DAYS">Dias da semana</option>
              <option value="ONCE">Uma única vez</option>
            </select>
          </Field>
          <Field label="Data inicial">
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => change("startDate", e.target.value)}
            />
          </Field>
          <Field label="Horário local">
            <input
              type="time"
              required
              value={form.timeOfDay}
              onChange={(e) => change("timeOfDay", e.target.value)}
            />
          </Field>
          <Field label="Fuso">
            <input
              required
              value={form.timezone}
              onChange={(e) => change("timezone", e.target.value)}
            />
          </Field>
          <Field label="Tentativas por lote">
            <input
              type="number"
              min="1"
              max="200"
              value={form.batchSize}
              onChange={(e) => change("batchSize", Number(e.target.value))}
            />
          </Field>
          <Field label="Intervalo entre lotes (segundos)">
            <input
              type="number"
              min="60"
              max="604800"
              value={form.batchIntervalSeconds}
              onChange={(e) =>
                change("batchIntervalSeconds", Number(e.target.value))
              }
            />
          </Field>
          <Field label="Entre mensagens (segundos)">
            <input
              type="number"
              min="1"
              max="300"
              value={form.pacingSeconds}
              onChange={(e) => change("pacingSeconds", Number(e.target.value))}
            />
          </Field>
        </div>
        {form.recurrence === "SPECIFIC_DAYS" && (
          <div className="flex gap-3">
            {[
              ["SUN", "Dom"],
              ["MON", "Seg"],
              ["TUE", "Ter"],
              ["WED", "Qua"],
              ["THU", "Qui"],
              ["FRI", "Sex"],
              ["SAT", "Sáb"],
            ].map(([v, label]) => (
              <label key={v}>
                <input
                  type="checkbox"
                  checked={form.specificDays.includes(v)}
                  onChange={(e) =>
                    change(
                      "specificDays",
                      e.target.checked
                        ? [...form.specificDays, v]
                        : form.specificDays.filter((x) => x !== v),
                    )
                  }
                />{" "}
                {label}
              </label>
            ))}
          </div>
        )}
        <MessageConfig value={form} onChange={setForm} error={error} />
        {(!form.messageCategory || form.messageCategory === "SERVICE") && (
          <Field label="Mensagem da regra">
            <textarea
              required={form.active && (!form.type || form.type === "TEXT")}
              value={form.message}
              onChange={(e) => change("message", e.target.value)}
            />
          </Field>
        )}
        <BudgetFields value={form} onChange={setForm} />
        <CostPreview preview={preview} />
        <label className="block">
          <input
            type="checkbox"
            checked={!!form.active}
            onChange={(e) => change("active", e.target.checked)}
          />{" "}
          Ativar regra ao salvar (desmarque para rascunho)
        </label>
        {editId && (
          <label className="block">
            <input
              type="checkbox"
              checked={!!form.reviewed}
              onChange={(e) => change("reviewed", e.target.checked)}
            />{" "}
            Revisei categoria, modelo e prévia de elegibilidade
          </label>
        )}
        <button className="btn primary" disabled={busy}>
          {editId ? "Salvar revisão" : "Criar regra"}
        </button>
      </form>
      {rules.map((r) => (
        <section className="panel space-y-3" key={r.id}>
          <div className="flex gap-3 justify-between">
            <h2 className="font-bold">
              {r.title} · {r.active ? "Ativa" : "Inativa"}
            </h2>
            <div className="flex gap-2">
              <button
                className="btn"
                onClick={() => {
                  setEditId(r.id);
                  setForm({
                    ...initial,
                    ...JSON.parse(r.config_json),
                    ...r.messageConfig,
                    title: r.title,
                    message: r.message,
                    categoryId: r.category_id || "",
                    recurrence: r.recurrence,
                    timeOfDay: r.time_of_day,
                    startDate: r.start_date || "",
                    timezone: r.timezone,
                    specificDays: r.specificDays,
                    active: !!r.active,
                    reviewed: false,
                  });
                }}
              >
                Editar / revisar
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    mutation("/schedules/" + r.id + "/toggle", {}, "PATCH"),
                  )
                }
              >
                {r.active ? "Desativar próximas ocorrências" : "Ativar regra"}
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Excluir a regra? Campanhas já criadas continuam disponíveis.",
                    )
                  )
                    act(() => mutation("/schedules/" + r.id, {}, "DELETE"));
                }}
              >
                Excluir regra
              </button>
            </div>
          </div>
          <p>
            {r.review_required ? "Revisão obrigatória antes de ativar. " : ""}
            {r.reason || ""}
            Próxima: {dateLabel(r.next_run_at, r.timezone)} · {r.timezone} ·{" "}
            {r.recurrence}
          </p>
          <details>
            <summary>Últimas ocorrências</summary>
            {r.executions.map((x) => (
              <p className="text-sm mt-2" key={x.due_at}>
                {dateLabel(x.due_at, r.timezone)} · {x.status}{" "}
                {x.campaign_id && (
                  <button className="btn" onClick={onOpenCampaign}>
                    Acompanhar nas campanhas
                  </button>
                )}
              </p>
            ))}
          </details>
        </section>
      ))}
    </div>
  );
}
