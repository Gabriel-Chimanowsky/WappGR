import { useState, useEffect } from "react";
import { api, mutation } from "../lib/api";
import { Field } from "./QueueUI";
export default function CloudSettings({ onRefresh }) {
  const [config, setConfig] = useState({
      phoneNumberId: "",
      wabaId: "",
      version: "",
    }),
    [status, setStatus] = useState(null),
    [templates, setTemplates] = useState([]),
    [rates, setRates] = useState([]),
    [events, setEvents] = useState([]),
    [billing, setBilling] = useState(null),
    [rateText, setRateText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function refresh() {
    const [s, t, r, e, b] = await Promise.all([
      api("/cloud/config"),
      api("/cloud/templates"),
      api("/cloud/rates"),
      api("/cloud/events"),
      api("/cloud/billing"),
    ]);
    setStatus(s);
    setTemplates(t);
    setRates(r);
    setEvents(e);
    setBilling(b);
    return s;
  }
  useEffect(() => {
    Promise.resolve()
      .then(refresh)
      .then((s) =>
        setConfig({
          phoneNumberId: s.phoneNumberId || "",
          wabaId: s.wabaId || "",
          version: s.version || "",
        }),
      )
      .catch((e) => setError(e.message));
  }, []);
  async function act(path, body) {
    setBusy(true);
    setError("");
    try {
      const r = await mutation("/cloud/" + path, body || {});
      setNotice(r.note || "Operação concluída.");
      await refresh();
      await onRefresh?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel space-y-4">
        <h2 className="font-bold text-xl">
          WhatsApp Business — Cloud API oficial
        </h2>
        <p className="notice">
          Transporte operacional: Cloud API da Meta. A configuração não registra
          nem migra o número. O teste abaixo consulta permissões e ativos sem
          enviar mensagens.
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
        <div className="grid md:grid-cols-3 gap-3">
          {[
            ["wabaId", "WhatsApp Business Account ID"],
            ["phoneNumberId", "Phone Number ID"],
            ["version", "Versão Graph API"],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                value={config[k]}
                placeholder={
                  k === "version" ? "Versão suportada no painel Meta" : ""
                }
                onChange={(e) => setConfig({ ...config, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <p className="text-sm text-slate-400">
          Configure somente no servidor: WAPPGR_CLOUD_TOKEN,
          WAPPGR_META_APP_SECRET e WAPPGR_WEBHOOK_VERIFY_TOKEN. O token de
          verificação do webhook é diferente do App Secret e do token de acesso.
        </p>
        <p>
          Token: {status?.tokenConfigured ? "configurado" : "ausente"} · App
          Secret: {status?.signatureConfigured ? "configurado" : "ausente"} ·
          Verificação:{" "}
          {status?.verificationConfigured ? "configurada" : "ausente"}
        </p>
        <p>
          Diagnóstico:{" "}
          {status?.verified ? "consulta validada" : "ainda não validado"} ·{" "}
          {status?.lastError?.reason || "Nenhum erro de consulta registrado."}
        </p>
        <p>
          Endpoint: <code>/api/webhooks/whatsapp</code> · Último evento:{" "}
          {status?.lastWebhookAt || "nenhum"} · Pendentes:{" "}
          {status?.pendingEvents || 0}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={busy}
            onClick={() => act("config", config)}
          >
            Salvar identificadores
          </button>
          <button className="btn" disabled={busy} onClick={() => act("test")}>
            Testar permissões sem enviar
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => act("templates/sync")}
          >
            Sincronizar modelos
          </button>
        </div>
      </section>
      <section className="panel space-y-3">
        <h2 className="font-bold text-lg">Catálogo de modelos</h2>
        <p className="text-sm">
          O estado é revalidado por sincronização completa com cache de até
          cinco minutos e invalidação por webhook. Alterações exigem revisão dos
          trabalhos afetados.
        </p>
        {!templates.length && <p>Nenhum modelo sincronizado.</p>}
        {templates.map((t) => (
          <details key={t.id} className="border border-slate-700 rounded p-3">
            <summary>
              {t.name} · {t.language} · {t.category} ·{" "}
              {t.present ? t.status : "AUSENTE"}
            </summary>
            <p>Sincronizado: {t.synced_at}</p>
            <pre className="whitespace-pre-wrap text-xs">
              {JSON.stringify(t.components, null, 2)}
            </pre>
            <p>
              Parâmetros:{" "}
              {t.slots
                .map((s) =>
                  [s.component, s.index, s.key].filter(Boolean).join(":"),
                )
                .join(", ") || "nenhum"}
            </p>
            {t.unsupported && <p className="error">{t.unsupported}</p>}
          </details>
        ))}
      </section>
      <section className="panel space-y-3">
        <h2 className="font-bold text-lg">Tarifas versionadas e cobrança</h2>
        <p>
          Importe uma tabela de referência com fonte oficial, moeda, vigência e
          valores por prefixo internacional e categoria. Não há consulta
          automática a um endpoint de preços. Revise as condições de gratuidade
          antes de marcá-las na tabela.
        </p>
        <Field label="Tabela de tarifas JSON">
          <textarea
            rows={8}
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            placeholder={
              '{"currency":"BRL","source":"https://business.whatsapp.com/products/platform-pricing","effectiveAt":"...","expiresAt":"...","rates":[{"prefix":"55","category":"MARKETING","amount":0.0}],"freeServiceWindow":false,"freeUtilityWindow":false}'
            }
          />
        </Field>
        <button
          className="btn"
          disabled={busy || !rateText.trim()}
          onClick={() => {
            try {
              const parsed = JSON.parse(rateText);
              act("rates", parsed);
            } catch {
              setError("JSON de tarifas inválido.");
            }
          }}
        >
          Importar nova versão de tarifas
        </button>
        {rates.map((r) => (
          <p key={r.id}>
            {r.currency} · {r.effective_at} até {r.expires_at} ·{" "}
            <a
              className="underline"
              href={r.source}
              target="_blank"
              rel="noreferrer"
            >
              Fonte
            </a>{" "}
            · {r.id}
          </p>
        ))}
        <details>
          <summary>Reconciliação de cobrança reportada</summary>
          <p>{billing?.note}</p>
          {billing?.messages.map((m) => (
            <p className="text-xs border-b border-slate-800 p-2" key={m.id}>
              {m.whatsapp_msg_id || "Sem ID oficial"} · intenção{" "}
              {m.intended_category} · modelo {m.approved_category || "—"} ·{" "}
              {m.sent_format} · {m.provider_status || m.status} ·{" "}
              {m.pricing_json || "Sem informação de cobrança recebida"}
            </p>
          ))}
        </details>
      </section>
      <details className="panel">
        <summary>Diagnóstico dos webhooks</summary>
        {events.map((e) => (
          <p className="text-xs py-2" key={e.id}>
            {e.created_at} · {e.status} · {e.error || "Persistido"}
          </p>
        ))}
      </details>
    </>
  );
}
