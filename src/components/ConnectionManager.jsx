import { dateLabel } from "../lib/presentation";
import { useState, useEffect, useRef } from "react";
import { api, mutation } from "../lib/api";
import { randomUUID } from "../lib/uuid";
import { Field, Status } from "./QueueUI";
import CloudSettings from "./CloudSettings";
export default function ConnectionManager({ onRefresh }) {
  const request = useRef(null);
  const [connection, setConnection] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [hours, setHours] = useState(24),
    [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    let alive = true,
      timer;
    async function poll() {
      try {
        const c = await api("/connection/status");
        if (alive) setConnection(c);
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
  }, []);
  async function act(path, body = {}) {
    setBusy(true);
    setError("");
    try {
      const encoded = JSON.stringify({ path, body });
      if (request.current?.encoded !== encoded)
        request.current = { encoded, key: randomUUID() };
      await mutation("/connection/" + path, body, "POST", request.current.key);
      request.current = null;
      setConnection(await api("/connection/status"));
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">Conexão e restrições da conta</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <CloudSettings onRefresh={onRefresh} />
      <section className="panel space-y-4">
        <h2 className="font-bold text-lg">Suspensão operacional</h2>
        <p className="notice">
          Restrições da conta bloqueiam todos os envios. Reconectar, reiniciar
          ou completar o prazo informado, inclusive 24 horas, não libera a fila:
          é necessária revisão e, depois, continuação explícita das campanhas.
          Uma chamada já em andamento pode concluir.
        </p>
        {!!connection?.account?.restricted && (
          <div className="error">
            <Status value="ACCOUNT_RESTRICTED" />
            <p>{connection.account.reason}</p>
            <p>
              Não liberar antes de: {dateLabel(connection.account.not_before)}
            </p>
          </div>
        )}
        <Field label="Motivo da suspensão ou registro da revisão">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {!connection?.account?.restricted ? (
          <>
            <Field label="Prazo mínimo informado pelo provedor (horas)">
              <input
                type="number"
                min="0"
                max="720"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </Field>
            <button
              className="btn danger"
              disabled={busy || !reason.trim()}
              onClick={() => act("restrict", { reason, hours })}
            >
              Suspender todos os envios
            </button>
          </>
        ) : (
          <>
            <label className="block">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />{" "}
              Revisei a situação e confirmei a liberação no provedor
            </label>
            <button
              className="btn"
              disabled={busy || !reviewed || !reason.trim()}
              onClick={() => act("review-release", { reason, reviewed })}
            >
              Registrar revisão e liberar a conta
            </button>
          </>
        )}
      </section>
    </div>
  );
}
