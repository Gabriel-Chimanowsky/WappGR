import { dateLabel } from "../lib/presentation";
import { useState, useEffect, useRef } from "react";
import { api, mutation } from "../lib/api";
import { Field } from "./QueueUI";
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
};
export default function SchedulerManager({ categories = [], onOpenCampaign }) {
  const [rules, setRules] = useState([]),
    [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(null);
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
          act(async () => {
            const encoded = JSON.stringify(form);
            if (request.current?.encoded !== encoded)
              request.current = { encoded, key: crypto.randomUUID() };
            await mutation("/schedules", form, "POST", request.current.key);
            request.current = null;
            setForm(initial);
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
        <Field label="Mensagem da regra">
          <textarea
            required
            value={form.message}
            onChange={(e) => change("message", e.target.value)}
          />
        </Field>
        <button className="btn primary" disabled={busy}>
          Criar regra
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
