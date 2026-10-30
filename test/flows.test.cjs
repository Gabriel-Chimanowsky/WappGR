const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers.cjs");
const { validateFlow, Flows } = require("../server/flows");
const { CloudApiAdapter } = require("../server/cloud-api");
function flow(f, steps) {
  const body = {
    name: "Fluxo de teste",
    trigger_type: "KEYWORD",
    trigger_keywords: "CATALOGO",
    steps,
    active: 1,
    messageCategory: "SERVICE",
  };
  const valid = validateFlow(body, f.db);
  f.db
    .prepare(
      "INSERT INTO flows(id,name,active,trigger_keywords,steps_json,updated_at,message_category) VALUES(?,?,?,?,?,?,'SERVICE')",
    )
    .run(
      "flow",
      "Teste",
      1,
      "CATALOGO",
      JSON.stringify(valid),
      new Date(f.now()).toISOString(),
    );
  return f.db.prepare("SELECT * FROM flows WHERE id=?").get("flow");
}
test("fluxo: categoria, fim vazio, deduplicação e atraso único", async () => {
  const f = fixture({ count: 1 }),
    lead = f.db.prepare("SELECT * FROM leads").get(),
    category = f.db.prepare("SELECT * FROM categories LIMIT 1").get();
  f.db.prepare("UPDATE leads SET category_id=?").run(category.id);
  flow(f, [
    {
      id: "a",
      type: "TEXT",
      content: "{categoria}",
      delaySeconds: 10,
      options: [{ label: "Finalizar", keyword: "2", nextStepId: "" }],
    },
  ]);
  const incoming = {
    msgId: "one",
    remoteJid: lead.phone + "@s.whatsapp.net",
    phone: "+" + lead.phone,
    text: "CATALOGO",
  };
  assert.equal(f.flows.receive(incoming), true);
  assert.equal(f.flows.receive(incoming), false);
  f.flows.tick();
  await f.dispatcher.tick();
  assert.equal(f.calls.length, 0);
  f.advance(10000);
  await f.dispatcher.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args[1].text, category.name);
  f.flows.tick();
  f.flows.receive({ ...incoming, msgId: "two", text: "2" });
  f.flows.tick();
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM lead_flow_sessions").get().n,
    0,
  );
  assert.equal(f.db.prepare("SELECT status FROM leads").get().status, "OPT_IN");
  f.db.close();
});
test("fluxo: continuidade recuperada, desativação interrompe, exclusão remove sessão", async () => {
  const f = fixture({ count: 1 }),
    lead = f.db.prepare("SELECT * FROM leads").get(),
    row = flow(f, [
      {
        id: "a",
        type: "TEXT",
        content: "A",
        delaySeconds: 0,
        options: [],
        nextStepId: "b",
      },
      { id: "b", type: "TEXT", content: "B", delaySeconds: 10, options: [] },
    ]);
  f.flows.start(lead, row);
  await f.step();
  f.flows.tick();
  const recovered = new Flows(f.db, f.dispatcher, { now: f.now });
  f.advance(10000);
  recovered.tick();
  await f.dispatcher.tick();
  assert.equal(f.calls.length, 2);
  for (const status of ["WAITING_WINDOW", "SUSPENDED"]) {
    f.flows.start(lead, row);
    f.flows.tick();
    const job = f.db
      .prepare("SELECT job_id FROM lead_flow_sessions")
      .get().job_id;
    f.db
      .prepare("UPDATE outbound_jobs SET status=? WHERE id=?")
      .run(status, job);
    f.db.prepare("UPDATE flows SET active=0").run();
    f.flows.tick();
    assert.equal(
      f.db.prepare("SELECT status FROM outbound_jobs WHERE id=?").get(job)
        .status,
      "CANCELLED",
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM lead_flow_sessions").get().n,
      0,
    );
    f.db.prepare("UPDATE flows SET active=1").run();
  }
  f.flows.start(lead, row);
  f.db.prepare("UPDATE flows SET active=0").run();
  f.flows.tick();
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM lead_flow_sessions").get().n,
    0,
  );
  f.db.prepare("UPDATE flows SET active=1").run();
  f.flows.start(lead, row);
  f.db.prepare("DELETE FROM leads").run();
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM lead_flow_sessions").get().n,
    0,
  );
  f.db.close();
});
test("fluxo: rejeita destinos e ciclos automáticos, permite retorno interativo", () => {
  const f = fixture({ count: 1 });
  assert.throws(() =>
    validateFlow(
      { name: "X", steps: [{ id: "a", type: "TEXT", nextStepId: "none" }] },
      f.db,
    ),
  );
  assert.throws(
    () =>
      validateFlow(
        { name: "X", steps: [{ id: "a", type: "TEXT", nextStepId: "a" }] },
        f.db,
      ),
    /Ciclo/,
  );
  assert.doesNotThrow(() =>
    validateFlow(
      {
        name: "X",
        steps: [
          {
            id: "a",
            type: "TEXT",
            options: [{ label: "Voltar", keyword: "1", nextStepId: "a" }],
          },
        ],
      },
      f.db,
    ),
  );
  f.db.close();
});
test("campanha, cron, fluxo e chat atravessam a mesma cadência", async () => {
  const f = fixture({ count: 1 });
  f.create();
  f.scheduler.create({
    messageCategory: "SERVICE",
    title: "Cron",
    message: "Cron",
    recurrence: "ONCE",
    timeOfDay: "09:01",
    startDate: "2026-10-15",
  });
  const lead = f.db.prepare("SELECT * FROM leads").get(),
    row = flow(f, [
      { id: "a", type: "TEXT", content: "Fluxo", delaySeconds: 0, options: [] },
    ]);
  f.flows.start(lead, row);
  f.dispatcher.enqueue({
    lead,
    kind: "HUMAN_REPLY",
    payload: { text: "Chat" },
  });
  f.setTime("2026-10-15T12:01:00Z");
  f.scheduler.tick();
  for (let i = 0; i < 30; i++) await f.step();
  assert.equal(f.calls.length, 4);
  assert.ok(
    f.calls.every((c, i) => !i || c.time - f.calls[i - 1].time >= 2000),
  );
  f.db.close();
});
test("Cloud API operacional: 24h, modelo aprovado, resultado incerto, restrição e recibo", async () => {
  const f = fixture({ count: 1 });
  let calls = 0;
  const adapter = new CloudApiAdapter({
    db: f.db,
    now: f.now,
    phoneNumberId: "12345",
    wabaId: "67890",
    token: "synthetic",
    version: "v99.0",
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ messages: [{ id: "wamid.test" }] }),
      };
    },
  });
  const lead = f.db.prepare("SELECT * FROM leads").get();
  const send = (config, recipient = lead) =>
    adapter.send(
      lead.phone,
      config.template
        ? require("../server/official-policy").templatePayload(
            require("../server/official-policy").validateMessage(f.db, config, {
              now: f.now(),
            }),
            lead,
          )
        : { type: "TEXT", text: "Oi" },
      "local",
      { messageConfig: config, getLead: () => recipient },
    );
  assert.equal(
    (
      await send(
        { messageCategory: "SERVICE" },
        {
          ...lead,
          cloud_last_inbound_at: new Date(f.now() - 86400000).toISOString(),
        },
      )
    ).definitelyNotSent,
    true,
  );
  assert.equal(calls, 0);
  assert.equal((await send({ messageCategory: "SERVICE" })).success, true);
  assert.equal((await send(f.messageConfig)).success, true);
  assert.equal(
    (
      await adapter.send(
        lead.phone,
        { type: "TEMPLATE", templateName: "nao-aprovado", language: "pt_BR" },
        "invalid",
        {
          messageConfig: {
            messageCategory: "MARKETING",
            template: { id: "missing", revision: "none" },
          },
          getLead: () => lead,
        },
      )
    ).success,
    false,
  );
  adapter.fetch = async () => {
    throw Error("timeout");
  };
  assert.equal((await send(f.messageConfig)).uncertain, true);
  adapter.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 131031 } }),
  });
  assert.equal((await send(f.messageConfig)).accountRestricted, true);
  assert.equal(
    CloudApiAdapter.parseStatus({
      id: "wamid.test",
      status: "delivered",
      biz_opaque_callback_data: "local",
    }).state,
    "DELIVERED",
  );
  f.db.close();
});
test("CSV: barra vertical, aspas, separadores, multilinha e roundtrip de consentimento", async () => {
  const { parseLeads } = await import("../shared/csv.mjs");
  const f = fixture({ count: 1 });
  const { Leads } = require("../server/leads");
  const leads = new Leads(f.db);
  f.db
    .prepare("UPDATE leads SET status='OPT_OUT',name=?,notes=?")
    .run('Pessoa; "Especial"', "linha 1\nlinha 2");
  const roundtrip = parseLeads(leads.export({ type: "filters" }));
  assert.equal(roundtrip[0].status, "OPT_OUT");
  assert.equal(roundtrip[0].name, 'Pessoa; "Especial"');
  assert.equal(roundtrip[0].notes, "linha 1\nlinha 2");
  assert.equal(roundtrip[0].lastInteraction, undefined);
  assert.equal(roundtrip[0].messagesSentCount, "0");
  assert.equal(
    parseLeads("Nome|Telefone\nTeste|11999999999")[0].phone,
    "11999999999",
  );
  assert.throws(() => parseLeads('Nome;Telefone\n"aspas abertas'), /Aspas/);
  f.db.close();
});

test("janela por destinatário: entrada antiga não renova 24h após reinício nem com envio humano", async () => {
  const { canSend } = require("../server/policy"),
    f = fixture({ count: 2 });
  f.db
    .prepare(
      "UPDATE leads SET status='PENDING',last_inbound_at=NULL,cloud_last_inbound_at=NULL",
    )
    .run();
  for (let i = 0; i < 2; i++) {
    const lead = f.db
      .prepare("SELECT * FROM leads WHERE id=?")
      .get("lead00000" + i);
    f.flows.receive({
      provider: "CLOUD_API",
      msgId: "window-" + i,
      remoteJid: lead.phone + "@s.whatsapp.net",
      phone: "+" + lead.phone,
      text: "Olá",
      clientTimestamp: new Date(
        f.now() - (i ? 3600000 : 90000000),
      ).toISOString(),
    });
  }
  f.advance(10000);
  f.flows.tick();
  const old = f.db.prepare("SELECT * FROM leads WHERE id=?").get("lead000000"),
    fresh = f.db.prepare("SELECT * FROM leads WHERE id=?").get("lead000001");
  assert.ok(canSend(old, "HUMAN_REPLY", f.now()));
  assert.equal(canSend(fresh, "HUMAN_REPLY", f.now()), null);
  assert.ok(
    canSend(
      { ...fresh, last_inbound_at: new Date(f.now() + 1000).toISOString() },
      "HUMAN_REPLY",
      f.now(),
    ),
  );
  const adapter = new CloudApiAdapter({
    db: f.db,
    now: f.now,
    wabaId: "456",
    phoneNumberId: "123",
    token: "synthetic",
    version: "v99.0",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.test" }] }),
    }),
  });
  assert.equal(
    (
      await adapter.send(old.phone, { type: "TEXT", text: "Texto" }, "old", {
        now: f.now(),
        messageConfig: { messageCategory: "SERVICE" },
        getLead: () => old,
        lastInboundAt: old.last_inbound_at,
      })
    ).success,
    false,
  );
  assert.equal(
    (
      await adapter.send(fresh.phone, { type: "TEXT", text: "Texto" }, "new", {
        now: f.now(),
        messageConfig: { messageCategory: "SERVICE" },
        getLead: () => fresh,
        lastInboundAt: fresh.last_inbound_at,
      })
    ).success,
    true,
  );
  f.db.close();
});
test("entrada aguardando processamento conserva instante recebido e autorização antiga não revoga opt-out", () => {
  const { consent } = require("../server/policy"),
    f = fixture({ count: 1 });
  const lead = f.db.prepare("SELECT * FROM leads").get();
  f.db.prepare("UPDATE leads SET last_inbound_at=NULL").run();
  f.flows.receive({
    msgId: "pending",
    remoteJid: lead.phone + "@s.whatsapp.net",
    phone: "+" + lead.phone,
    text: "Olá",
  });
  const received = new Date(f.now()).toISOString();
  f.advance(90000000);
  f.flows.tick();
  assert.equal(
    f.db.prepare("SELECT last_inbound_at FROM leads").get().last_inbound_at,
    received,
  );
  consent(
    f.db,
    lead.id,
    "OPT_OUT",
    { source: "TEST", reason: "Recusa atual" },
    f.now(),
  );
  f.flows.receive({
    msgId: "old-sim",
    remoteJid: lead.phone + "@s.whatsapp.net",
    phone: "+" + lead.phone,
    text: "SIM",
    clientTimestamp: received,
  });
  f.flows.tick();
  assert.equal(
    f.db.prepare("SELECT status FROM leads").get().status,
    "OPT_OUT",
  );
  f.db.close();
});

test("transporte Baileys: mídia usa preflight após download e preserva classificação de falha", async () => {
  const { BaileysManager } = require("../server/baileys");
  const transport = new BaileysManager();
  transport.state = "CONNECTED";
  let calls = 0;
  transport.sock = {
    sendMessage: async (jid, payload, options) => {
      calls++;
      return { key: { id: options.messageId } };
    },
  };
  const originalFetch = global.fetch,
    originalHosts = process.env.WAPPGR_MEDIA_HOSTS;
  process.env.WAPPGR_MEDIA_HOSTS = "synthetic.invalid";
  let blocked = false;
  global.fetch = async () => {
    blocked = true;
    return new Response(Buffer.from([0, 1, 2]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  try {
    const result = await transport.send(
      "5511999999999",
      {
        type: "IMAGE",
        mediaUrl: "https://synthetic.invalid/file",
        text: "Teste",
      },
      "synthetic-id",
      { beforeSend: () => (blocked ? "Fluxo desativado" : null) },
    );
    assert.equal(result.definitelyNotSent, true);
    assert.equal(result.success, false);
    assert.equal(calls, 0);
    assert.equal(
      (
        await transport.send(
          "5511999999999",
          { type: "TEXT", text: "Teste" },
          "synthetic-id",
        )
      ).success,
      true,
    );
    assert.equal(calls, 1);
    transport.sock.sendMessage = async () => {
      throw Error("incerto");
    };
    assert.equal(
      (
        await transport.send(
          "5511999999999",
          { type: "TEXT", text: "Teste" },
          "synthetic-id",
        )
      ).uncertain,
      true,
    );
  } finally {
    global.fetch = originalFetch;
    if (originalHosts === undefined) delete process.env.WAPPGR_MEDIA_HOSTS;
    else process.env.WAPPGR_MEDIA_HOSTS = originalHosts;
  }
});
