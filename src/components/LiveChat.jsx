import { dateLabel } from "../lib/presentation";
import { useState, useEffect, useRef } from "react";
import { api, mutation } from "../lib/api";
import { randomUUID } from "../lib/uuid";
import { Field, Pager, Status } from "./QueueUI";
export default function LiveChat() {
  const [search, setSearch] = useState(""),
    [contacts, setContacts] = useState(null),
    [contactPage, setContactPage] = useState(1),
    [lead, setLead] = useState(null),
    [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [drafts, setDrafts] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(null),
    selected = useRef(null);
  useEffect(() => {
    selected.current = lead?.id;
  }, [lead]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        api(
          "/leads?" +
            new URLSearchParams({ search, page: contactPage, limit: 50 }),
        )
          .then((v) => {
            if (live) setContacts(v);
          })
          .catch((e) => {
            if (live) setError(e.message);
          }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search, contactPage]);
  useEffect(() => {
    if (!lead) return;
    let live = true,
      timer;
    async function poll() {
      try {
        const d = await api(
          "/chat/messages?" +
            new URLSearchParams({ leadId: lead.id, page, limit: 50 }),
        );
        if (live) setData(d);
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) timer = setTimeout(poll, 2500);
      }
    }
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lead, page]);
  async function send(e) {
    e.preventDefault();
    const leadId = lead.id,
      text = drafts[leadId] || "";
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const body = { leadId, text },
        encoded = JSON.stringify(body);
      if (request.current?.encoded !== encoded)
        request.current = { encoded, key: randomUUID() };
      await mutation("/chat/send", body, "POST", request.current.key);
      setDrafts((d) => ({ ...d, [leadId]: "" }));
      request.current = null;
      if (selected.current === leadId)
        setData(await api("/chat/messages?leadId=" + leadId + "&page=1"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Atendimento individual</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="notice">
        Regra interna de atendimento: mensagem recebida nas últimas 24h ou
        opt-in. Esse prazo é uma escolha do WappGR, não uma exigência técnica do
        Baileys. A fila e as restrições de conta são compartilhadas com as
        automações.
      </p>
      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        <aside className="panel space-y-3">
          <Field label="Buscar conversa">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setContactPage(1);
              }}
            />
          </Field>
          <div className="max-h-[500px] overflow-auto">
            {contacts?.leads.map((l) => (
              <button
                className={
                  "block w-full p-3 text-left border-b border-slate-800 " +
                  (lead?.id === l.id ? "text-emerald-400" : "")
                }
                key={l.id}
                onClick={() => {
                  setData(null);
                  setLead(l);
                  setPage(1);
                }}
              >
                {l.name}
                <small className="block text-slate-400">{l.phone}</small>
              </button>
            ))}
          </div>
          <Pager pagination={contacts?.pagination} onChange={setContactPage} />
        </aside>
        <section className="panel space-y-4">
          {lead ? (
            <>
              <h2 className="font-bold">
                {lead.name} · <Status value={lead.status} />
              </h2>
              <div className="h-[480px] overflow-auto space-y-3">
                {data?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      "rounded-xl p-3 max-w-[85%] " +
                      (m.direction === "OUTBOUND"
                        ? "ml-auto bg-emerald-950/60"
                        : "bg-slate-800")
                    }
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <div className="text-xs text-slate-400 mt-2">
                      {dateLabel(m.timestamp)} · <Status value={m.status} />
                      {m.status === "DELIVERED"
                        ? " ✓✓"
                        : m.status === "READ"
                          ? " ✓✓ lida"
                          : m.status === "SENT"
                            ? " ✓"
                            : ""}
                    </div>
                    {m.error && (
                      <p className="text-xs text-rose-300">{m.error}</p>
                    )}
                  </div>
                ))}
                {data?.jobs
                  .filter((j) => j.kind === "HUMAN_REPLY")
                  .map((j) => (
                    <div key={j.id} className="ml-auto notice max-w-[85%]">
                      <p>{JSON.parse(j.payload_json).text}</p>
                      <Status value={j.status} />
                      {j.error && <p>{j.error}</p>}
                    </div>
                  ))}
              </div>
              <Pager pagination={data?.pagination} onChange={setPage} />
              <form className="flex gap-3 items-end" onSubmit={send}>
                <div className="flex-1">
                  <Field label="Mensagem de atendimento">
                    <textarea
                      value={drafts[lead.id] || ""}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [lead.id]: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <button className="btn primary" disabled={busy}>
                  {busy ? "Enfileirando…" : "Enviar"}
                </button>
              </form>
            </>
          ) : (
            <p>
              Escolha um contato para carregar o histórico completo por páginas.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
