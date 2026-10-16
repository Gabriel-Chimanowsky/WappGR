import { useState, useEffect } from "react";
import { api, mutation } from "../lib/api";
import { Field } from "./QueueUI";
export default function CRMIntegration() {
  const [config, setConfig] = useState(null),
    [base, setBase] = useState(""),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [payload, setPayload] = useState(
      JSON.stringify(
        {
          name: "Exemplo sintético",
          phone: "+5511999999999",
          optInConfirmed: false,
        },
        null,
        2,
      ),
    );
  useEffect(() => {
    let live = true;
    api("/crm/config")
      .then((c) => {
        if (live) {
          setConfig(c);
          setBase(c.publicBaseUrl);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const url = (base || window.location.origin) + "/api/v1/crm/webhook/lead";
  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Webhook de entrada CRM</h1>
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
      <form
        className="panel space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            setConfig(await mutation("/crm/config", { publicBaseUrl: base }));
            setNotice("Configuração salva.");
          });
        }}
      >
        <Field label="URL base da instalação (opcional)">
          <input
            placeholder={window.location.origin}
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </Field>
        <p className="notice break-all">POST {url}</p>
        <p>
          Chave:{" "}
          {config?.configured
            ? "configurada"
            : "não configurada — webhook desabilitado"}
          . Use o cabeçalho x-api-key.
        </p>
        <button className="btn primary" disabled={busy}>
          Salvar configuração
        </button>{" "}
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              !config?.configured ||
              confirm(
                "Revogar a chave atual e gerar outra? Integrações existentes precisarão ser atualizadas.",
              )
            )
              act(async () => {
                const r = await mutation("/crm/rotate-key");
                setSecret(r.apiKey);
                setConfig({ ...config, configured: true });
                setNotice(r.message);
              });
          }}
        >
          Gerar / rotacionar chave
        </button>
        {secret && (
          <div className="notice break-all">
            <code>{secret}</code>
            <button
              type="button"
              className="btn ml-2"
              onClick={() => navigator.clipboard.writeText(secret)}
            >
              Copiar chave
            </button>
          </div>
        )}
      </form>
      <section className="panel space-y-4">
        <h2 className="font-bold">Validar JSON sem executar</h2>
        <p className="notice">
          Este simulador não salva contatos nem envia mensagens. O webhook real
          preserva o opt-out existente. Novos opt-ins exigem optInConfirmed=true
          e consentEvidence descrevendo a evidência.
        </p>
        <Field label="JSON de exemplo">
          <textarea
            rows="8"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </Field>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const r = await mutation("/crm/simulate", JSON.parse(payload));
              setNotice(r.message);
            })
          }
        >
          Validar simulação
        </button>
      </section>
      <p className="text-sm text-slate-400">
        Integração HTTP genérica de entrada. Eventos de saída e conectores
        específicos de CRM não estão implementados.
      </p>
    </div>
  );
}
