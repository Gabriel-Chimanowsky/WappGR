import { useEffect, useId, useState } from "react";
import categories from "../../shared/message-categories.json";
import { slotId } from "../../shared/template-parameters.mjs";
import { api } from "../lib/api";
import { Field } from "./QueueUI";
import { categoryLabel } from "../lib/presentation";
export function CategoryField({
  value,
  onChange,
  error,
  label = "Categoria da mensagem",
}) {
  const name = useId();
  return (
    <fieldset
      className="space-y-3"
      aria-describedby={error ? name + "-error" : undefined}
    >
      <legend className="font-bold text-base">{label}</legend>
      <div className="grid md:grid-cols-3 gap-3">
        {categories.map((c) => (
          <label
            key={c.value}
            className={
              "cursor-pointer rounded-xl border p-4 " +
              (value === c.value
                ? "border-emerald-400 bg-emerald-950/40"
                : "border-slate-600 bg-slate-900/50")
            }
          >
            <span className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                aria-label={c.label}
                name={name}
                value={c.value}
                checked={value === c.value}
                onChange={() => onChange(c.value)}
              />
              {c.label}
            </span>
            <span className="block text-sm text-slate-300 mt-2">
              {c.description}
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm text-slate-400">
        A seleção define a intenção e as regras de execução. Não garante
        gratuidade nem substitui a classificação aprovada pela Meta.
      </p>
      {error && (
        <p id={name + "-error"} className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
export default function MessageConfig({
  value,
  onChange,
  error,
  inheritCategory,
  categoryOnly = false,
  formats = true,
}) {
  const [templates, setTemplates] = useState([]),
    [loadError, setLoadError] = useState("");
  useEffect(() => {
    let live = true;
    api("/cloud/templates")
      .then((t) => {
        if (live) setTemplates(t);
      })
      .catch((e) => {
        if (live) setLoadError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const inherited =
    inheritCategory !== undefined &&
    !value.overrideCategory &&
    !value.messageCategory;
  const effective = inherited ? inheritCategory : value.messageCategory;
  const change = (patch) => onChange({ ...value, ...patch });
  const selected = templates.find((t) => t.id === value.template?.id);
  const choices = templates.filter(
    (t) =>
      t.present &&
      t.status === "APPROVED" &&
      t.category === effective &&
      !t.unsupported,
  );
  return (
    <div className="space-y-4">
      {inheritCategory !== undefined && (
        <>
          <label className="flex gap-2 items-center">
            <input
              type="checkbox"
              checked={!inherited}
              onChange={(e) =>
                change({
                  overrideCategory: e.target.checked,
                  messageCategory: null,
                  template: null,
                })
              }
            />
            Substituir categoria nesta etapa
          </label>
          <p className="notice">
            Categoria efetiva: <strong>{categoryLabel(effective)}</strong> ·{" "}
            {inherited ? "Herdada do fluxo" : "Substituição explícita"}
          </p>
        </>
      )}
      {!inherited && (
        <CategoryField
          value={value.messageCategory}
          error={error}
          onChange={(messageCategory) =>
            change({ messageCategory, template: null, type: "TEXT" })
          }
        />
      )}
      {inherited && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!categoryOnly && effective === "SERVICE" && (
        <>
          <p className="notice">
            Cada destinatário deve ter enviado uma mensagem nas últimas 24
            horas. A janela é revalidada antes de cada envio; mensagens da
            empresa não a renovam.
          </p>
          {value.type === "AUDIO" && (
            <p className="notice">
              Áudio não aceita legenda. Em campanhas e regras, deixe o texto
              vazio; em fluxos, o acompanhamento será enviado como outra
              mensagem de Serviço.
            </p>
          )}
          {formats && (
            <Field label="Formato da mensagem">
              <select
                value={value.type || "TEXT"}
                onChange={(e) => change({ type: e.target.value })}
              >
                {[
                  ["TEXT", "Texto"],
                  ["IMAGE", "Imagem"],
                  ["VIDEO", "Vídeo"],
                  ["AUDIO", "Áudio"],
                  ["DOCUMENT", "Documento"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {formats && value.type && value.type !== "TEXT" && (
            <Field label="URL HTTPS da mídia">
              <input
                type="url"
                value={value.mediaUrl || ""}
                onChange={(e) => change({ mediaUrl: e.target.value })}
              />
              <small>
                O domínio deve estar autorizado no servidor. A Meta busca a
                mídia pela URL.
              </small>
            </Field>
          )}
        </>
      )}
      {!categoryOnly && ["UTILITY", "MARKETING"].includes(effective) && (
        <>
          <p className="notice">
            {effective === "UTILITY"
              ? "Exemplos: confirmação de pedido, atualização de entrega ou lembrete solicitado. Conteúdo promocional não se torna utilidade pela seleção."
              : "Marketing exige consentimento atual. Opt-out e limites informados pela plataforma continuam aplicados."}
          </p>
          {loadError && <p className="error">{loadError}</p>}
          <Field label="Modelo aprovado">
            <select
              value={value.template?.id || ""}
              onChange={(e) => {
                const t = templates.find((t) => t.id === e.target.value);
                change({
                  template: t
                    ? { id: t.id, revision: t.revision, parameters: {} }
                    : null,
                });
              }}
            >
              <option value="">Selecione um modelo</option>
              {value.template &&
                !choices.some((t) => t.id === value.template.id) && (
                  <option value={value.template.id}>
                    Modelo anterior indisponível — revise
                  </option>
                )}
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.language}
                </option>
              ))}
            </select>
          </Field>
          {!choices.length && (
            <p className="text-sm text-amber-300">
              Nenhum modelo aprovado compatível. Sincronize o catálogo em
              Conectar WhatsApp.
            </p>
          )}
          {selected && (
            <div className="panel space-y-3">
              <p>
                {selected.name} · {selected.language} · {selected.category} ·{" "}
                {selected.status}
              </p>
              <pre className="whitespace-pre-wrap text-sm">
                {selected.components
                  .map(
                    (c) =>
                      c.text ||
                      (c.type === "BUTTONS"
                        ? c.buttons?.map((b) => b.text).join(" · ")
                        : "[" + (c.format || c.type) + "]"),
                  )
                  .join("\n")}
              </pre>
              <small>
                Conteúdo aprovado, somente leitura. Sincronizado:{" "}
                {selected.synced_at}
              </small>
              {selected.revision !== value.template.revision && (
                <p className="error">
                  O modelo mudou. Selecione-o novamente e revise a configuração.
                </p>
              )}
              {selected.slots.map((slot) => {
                const key = slotId(slot),
                  p = value.template.parameters?.[key] || {
                    source: "literal",
                    value: "",
                  };
                const update = (patch) =>
                  change({
                    template: {
                      ...value.template,
                      parameters: {
                        ...value.template.parameters,
                        [key]: { ...p, ...patch },
                      },
                    },
                  });
                return (
                  <div className="grid md:grid-cols-2 gap-2" key={key}>
                    <Field label={"Origem do parâmetro " + key}>
                      <select
                        value={p.source}
                        onChange={(e) => update({ source: e.target.value })}
                      >
                        <option value="literal">Valor informado</option>
                        {slot.type === "text" && (
                          <>
                            <option value="name">Nome do contato</option>
                            <option value="phone">Telefone</option>
                            <option value="category">
                              Categoria do contato
                            </option>
                          </>
                        )}
                      </select>
                    </Field>
                    {p.source === "literal" && (
                      <Field label={"Valor do parâmetro " + key}>
                        <input
                          value={p.value || ""}
                          onChange={(e) => update({ value: e.target.value })}
                          placeholder={
                            slot.type === "text"
                              ? "Valor permitido"
                              : "https://dominio-autorizado/arquivo"
                          }
                        />
                      </Field>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {effective === "UTILITY" && (
            <Field label="Referência ao pedido, solicitação ou evento">
              <input
                value={value.relatedReference || ""}
                onChange={(e) => change({ relatedReference: e.target.value })}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}
export function CostPreview({ preview }) {
  if (!preview) return null;
  const cost = preview.cost;
  return (
    <div className="notice space-y-2">
      <p>
        Categoria: {categoryLabel(preview.messageCategory)} · {preview.eligible}{" "}
        elegíveis · {preview.reasons?.outsideWindow || 0} fora da janela ·{" "}
        {preview.excluded || 0} excluídos
      </p>
      {cost?.template && (
        <p>
          Modelo: {cost.template.name} · {cost.template.language}
        </p>
      )}
      {cost?.available ? (
        <>
          <p>
            <strong>
              Estimativa: {cost.currency} {cost.total.toFixed(4)}
            </strong>{" "}
            · {cost.messages} mensagens · {cost.freeMessages} com gratuidade
            confirmada pela regra importada
          </p>
          <p>
            Tarifas:{" "}
            {cost.rates
              .map((r) => r.prefix + ": " + r.referenceRate)
              .join(" · ")}{" "}
            · Vigência: {cost.effectiveAt} até {cost.expiresAt}
          </p>
          <a
            href={cost.source}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Fonte da tarifa
          </a>
          <p className="text-sm">{cost.conditions}</p>
        </>
      ) : (
        <p>
          <strong>Estimativa indisponível</strong> —{" "}
          {cost?.reason ||
            "Selecione a categoria e configure uma tabela vigente."}
        </p>
      )}
      {preview.budgetReason && <p className="error">{preview.budgetReason}</p>}
    </div>
  );
}
export function BudgetFields({ value, onChange }) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Field label="Orçamento máximo (opcional)">
        <input
          type="number"
          min="0"
          step="0.0001"
          value={value.maxBudget ?? ""}
          onChange={(e) => onChange({ ...value, maxBudget: e.target.value })}
        />
      </Field>
      <Field label="Moeda do orçamento">
        <input
          maxLength={3}
          value={value.currency || ""}
          placeholder="BRL"
          onChange={(e) =>
            onChange({ ...value, currency: e.target.value.toUpperCase() })
          }
        />
      </Field>
    </div>
  );
}
