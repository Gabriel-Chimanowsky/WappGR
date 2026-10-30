const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers.cjs");
const { Dispatcher } = require("../server/dispatcher");
const { consent } = require("../server/policy");
const { Leads } = require("../server/leads");
const command = (f, c, action, body = {}, key = crypto.randomUUID()) =>
  f.campaigns.control(c.id, action, body, key, "tester");
test("1000 contatos: 25 lotes, 24 intervalos medidos após término e nenhuma espera final", async () => {
  const f = fixture({ count: 1000 }),
    c = f.create();
  const result = await f.drain(c.id);
  assert.equal(result.sent, 1000);
  assert.equal(result.attempts, 1000);
  assert.equal(result.next_run_at, null);
  const batches = f.db
    .prepare("SELECT * FROM campaign_batches ORDER BY number")
    .all();
  assert.equal(batches.length, 25);
  assert.equal(batches.filter((b) => b.next_run_at).length, 24);
  assert.ok(batches.every((b) => b.attempts === 40));
  for (let i = 1; i < batches.length; i++)
    assert.ok(
      Date.parse(batches[i].started_at) -
        Date.parse(batches[i - 1].finished_at) >=
        7200000,
    );
  f.db.close();
});
test("pausa no 17 preserva o saldo de 23, sem reenviar confirmados", async () => {
  const f = fixture(),
    c = f.create();
  await f.step(17);
  command(f, c, "pause");
  await f.step(5);
  assert.equal(f.calls.length, 17);
  command(f, c, "resume");
  await f.step(23);
  const v = f.campaigns.get(c.id);
  assert.equal(v.batch.attempts, 40);
  assert.equal(v.current_batch, 1);
  assert.equal(v.sent, 40);
  assert.equal(new Set(f.calls.map((c) => c.args[0])).size, 40);
  f.db.close();
});
test("pausa com chamada em voo só confirma pausa após resultado", async () => {
  let resolve;
  const f = fixture({ send: () => new Promise((r) => (resolve = r)) }),
    c = f.create();
  const p = f.dispatcher.tick();
  await new Promise(setImmediate);
  command(f, c, "pause");
  assert.equal(f.campaigns.get(c.id).execution_status, "PAUSE_REQUESTED");
  await f.dispatcher.tick();
  assert.equal(f.calls.length, 1);
  resolve({ success: true });
  await p;
  assert.equal(f.campaigns.get(c.id).execution_status, "PAUSED");
  f.db.close();
});
test("pausar intervalo e retomar não antecipa horário mínimo", async () => {
  const f = fixture(),
    c = f.create();
  await f.step(40);
  const next = f.campaigns.get(c.id).next_run_at;
  command(f, c, "pause");
  f.advance(10000);
  command(f, c, "resume");
  await f.step();
  assert.equal(f.calls.length, 40);
  assert.equal(f.campaigns.get(c.id).next_run_at, next);
  f.setTime(next);
  await f.step();
  assert.equal(f.calls.length, 41);
  f.db.close();
});
test("modo manual exige autorização independente de continuar e do relógio", async () => {
  const f = fixture(),
    c = f.create({ mode: "MANUAL", batchSize: 2 });
  await f.step(2);
  f.advance(7200000);
  await f.step();
  assert.equal(f.calls.length, 2);
  command(f, c, "pause");
  command(f, c, "resume");
  await f.step();
  assert.equal(f.calls.length, 2);
  command(f, c, "authorize-next");
  await f.step();
  assert.equal(f.calls.length, 3);
  f.db.close();
});
test("desconexão não consome tentativas; reconexão respeita pausa", async () => {
  const f = fixture(),
    c = f.create();
  f.connect(false);
  await f.step(10);
  assert.equal(f.calls.length, 0);
  assert.equal(f.campaigns.get(c.id).execution_status, "WAITING_CONNECTION");
  command(f, c, "pause");
  f.connect(true);
  await f.step();
  assert.equal(f.calls.length, 0);
  command(f, c, "resume");
  await f.step();
  assert.equal(f.calls.length, 1);
  f.db.close();
});
test("recepção de opt-out tem prioridade e impede destinatário pendente", async () => {
  const f = fixture({ count: 2 }),
    c = f.create();
  await f.step();
  const lead = f.db.prepare("SELECT * FROM leads WHERE id=?").get("lead000001");
  f.flows.receive({
    msgId: "out-1",
    remoteJid: lead.phone + "@s.whatsapp.net",
    phone: "+" + lead.phone,
    text: "SAIR",
  });
  f.flows.tick();
  await f.drain(c.id);
  assert.equal(f.campaigns.get(c.id).counts.SKIPPED, 1);
  assert.equal(
    f.calls.filter((x) => x.args[1].text.startsWith("Olá")).length,
    1,
  );
  f.db.close();
});
test("exclusão e alteração de identidade não redirecionam a audiência", async () => {
  const f = fixture({ count: 3 }),
    c = f.create();
  f.db.prepare("DELETE FROM leads WHERE id=?").run("lead000000");
  f.db
    .prepare("UPDATE leads SET phone=? WHERE id=?")
    .run("5511988888888", "lead000001");
  const v = await f.drain(c.id);
  assert.equal(v.counts.SKIPPED, 2);
  assert.equal(f.calls.length, 1);
  f.db.close();
});
test("criação e comandos idempotentes com associação ao conteúdo", async () => {
  const f = fixture();
  const a = f.create({}, "same"),
    b = f.create({}, "same");
  assert.equal(a.id, b.id);
  assert.throws(
    () => f.create({ message: "Outro" }, "same"),
    (e) => e.status === 409,
  );
  command(f, a, "pause", {}, "pause");
  assert.throws(
    () => command(f, a, "resume", { action: "pause" }, "pause"),
    (e) => e.status === 409,
  );
  command(f, a, "pause", {}, "pause");
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM campaign_events WHERE kind='CONTROL'")
      .get().n,
    1,
  );
  f.db.close();
});
test("duas aquisições do mesmo trabalho não geram chamada duplicada", async () => {
  let resolve;
  const f = fixture({
      count: 1,
      send: () => new Promise((r) => (resolve = r)),
    }),
    c = f.create();
  const r = f.db.prepare("SELECT * FROM campaign_recipients").get();
  const first = f.dispatcher.processRecipient(c, r);
  await f.dispatcher.processRecipient(c, r);
  assert.equal(f.calls.length, 1);
  resolve({ success: true });
  await first;
  assert.equal(f.campaigns.get(c.id).attempts, 1);
  f.db.close();
});
test("recuperação marca chamada interrompida incerta e recibo reconcilia", async () => {
  const f = fixture({ count: 2 }),
    c = f.create();
  f.db
    .prepare(
      "UPDATE campaign_recipients SET status='SENDING',attempts=1 WHERE position=1",
    )
    .run();
  const d = new Dispatcher(f.db, f.campaigns, f.provider, { now: f.now });
  d.recover();
  assert.equal(f.campaigns.get(c.id).counts.UNCERTAIN, 1);
  await f.drain(c.id);
  assert.equal(f.calls.length, 1);
  f.db.close();
});
test("retry transitório consome vaga, respeita backoff e limite do lote", async () => {
  let n = 0;
  const f = fixture({
      count: 3,
      send: async () =>
        ++n === 1
          ? {
              success: false,
              definitelyNotSent: true,
              retryable: true,
              error: "temporário",
            }
          : { success: true },
    }),
    c = f.create({ batchSize: 2 });
  await f.step(2);
  assert.equal(f.campaigns.get(c.id).execution_status, "WAITING_INTERVAL");
  const v = await f.drain(c.id);
  assert.equal(v.attempts, 4);
  assert.equal(v.sent, 3);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM campaign_batches").get().n,
    2,
  );
  f.db.close();
});
test("retry seletivo adiciona uma tentativa limitada e preserva histórico", async () => {
  let succeeds = false;
  const f = fixture({
      count: 1,
      send: async () =>
        succeeds
          ? { success: true }
          : {
              success: false,
              definitelyNotSent: true,
              retryable: true,
              error: "temporário",
            },
    }),
    c = f.create({ maxAttempts: 1 });
  await f.drain(c.id);
  succeeds = true;
  const r = f.db.prepare("SELECT id FROM campaign_recipients").get();
  command(f, c, "retry", { recipientIds: [r.id] });
  const v = await f.drain(c.id);
  assert.equal(v.sent, 1);
  assert.equal(v.attempts, 2);
  f.db.close();
});
test("resultado incerto e falha permanente nunca recebem retry automático", async () => {
  for (const response of [
    { success: false, uncertain: true },
    { success: false, definitelyNotSent: true, retryable: false },
  ]) {
    const f = fixture({ count: 1, send: async () => response }),
      c = f.create();
    await f.drain(c.id);
    assert.equal(f.calls.length, 1);
    const r = f.db.prepare("SELECT id FROM campaign_recipients").get();
    assert.throws(() => command(f, c, "retry", { recipientIds: [r.id] }));
    f.db.close();
  }
});
test("cancelamento preserva sucessos e impede novos envios", async () => {
  const f = fixture(),
    c = f.create();
  await f.step(3);
  command(f, c, "cancel");
  await f.step(5);
  assert.equal(f.calls.length, 3);
  assert.equal(f.campaigns.get(c.id).counts.CANCELLED, 47);
  f.db.close();
});
test("campanha e respostas compartilham uma chamada e cadência global", async () => {
  const f = fixture({ count: 5 }),
    c = f.create();
  const lead = f.db.prepare("SELECT * FROM leads LIMIT 1").get();
  for (let i = 0; i < 4; i++)
    f.dispatcher.enqueue({
      lead,
      kind: "HUMAN_REPLY",
      payload: { text: "resposta" + i },
    });
  for (let i = 0; i < 10; i++) {
    await f.dispatcher.tick();
    await f.dispatcher.tick();
    f.advance(2000);
  }
  assert.ok(
    f.calls.every((c, i) => !i || c.time - f.calls[i - 1].time >= 2000),
  );
  assert.equal(f.calls[3].args[1].text.startsWith("Olá"), true);
  assert.equal(f.campaigns.get(c.id).sent, 5);
  f.db.close();
});
test("filtro acima de 10000, exclusões, ordenação e snapshot congelado", () => {
  const f = fixture({ count: 10005 }),
    selection = { type: "filters", filters: {}, excludedIds: ["lead000003"] };
  assert.equal(f.campaigns.audience(selection).summary.eligible, 10004);
  const c = f.create({ selection });
  f.db
    .prepare(
      "INSERT INTO leads(id,name,phone,status) VALUES('new','Novo','5511999999999','OPT_IN')",
    )
    .run();
  assert.equal(f.campaigns.get(c.id).total_target, 10004);
  assert.equal(
    f.campaigns.recipients(c.id, { page: 201, limit: 50 }).rows.length,
    4,
  );
  f.db.close();
});
test("ONCE cria execução rastreável uma vez e desativa regra", () => {
  const f = fixture({ count: 1 });
  f.scheduler.create({
    ...f.messageConfig,
    title: "Regra",
    message: "Oi",
    recurrence: "ONCE",
    timeOfDay: "10:00",
    startDate: "2026-10-15",
    timezone: "America/Sao_Paulo",
  });
  f.setTime("2026-10-15T13:00:00Z");
  f.provider.refreshIfDue(); // Synthetic successful catalog refresh before cron.
  f.scheduler.tick();
  f.provider.refreshIfDue(); // Synthetic successful catalog refresh before cron.
  f.scheduler.tick();
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM schedule_occurrences").get().n,
    1,
  );
  assert.equal(f.db.prepare("SELECT active FROM schedules").get().active, 0);
  assert.equal(f.campaigns.list().length, 1);
  f.db.close();
});
test("recorrência alternada usa calendário e limita recuperação de atrasos", () => {
  const f = fixture({ count: 1 });
  f.scheduler.create({
    ...f.messageConfig,
    title: "Regra",
    message: "Oi",
    recurrence: "EVERY_OTHER_DAY",
    timeOfDay: "10:00",
    startDate: "2026-10-15",
    timezone: "America/Sao_Paulo",
  });
  f.setTime("2026-10-20T13:00:00Z");
  f.provider.refreshIfDue(); // Synthetic successful catalog refresh before cron.
  f.scheduler.tick();
  f.provider.refreshIfDue(); // Synthetic successful catalog refresh before cron.
  f.scheduler.tick();
  assert.equal(
    f.db.prepare("SELECT next_run_at FROM schedules").get().next_run_at,
    "2026-10-21T13:00:00.000Z",
  );
  assert.equal(f.campaigns.list().length, 1);
  f.db.close();
});
test("reimportação e cadastro não inventam autorização", () => {
  const f = fixture({ count: 1 });
  const leads = new Leads(f.db, { now: f.now });
  consent(f.db, "lead000000", "OPT_OUT", { source: "TEST", reason: "Recusa" });
  leads.import(
    {
      leads: [
        { name: "Atualizado", phone: "+5511900000000", status: "OPT_IN" },
      ],
      updateExisting: true,
      consentEvidence: true,
      consentReason: "Lote",
    },
    "tester",
  );
  assert.equal(leads.get("lead000000").status, "OPT_OUT");
  const result = leads.import({
    leads: [{ name: "Novo", phone: "55999999999", status: "OPT_IN" }],
  });
  assert.equal(result.imported, 1);
  assert.equal(
    f.db.prepare("SELECT status,phone FROM leads WHERE name='Novo'").get()
      .phone,
    "5555999999999",
  );
  assert.equal(
    f.db.prepare("SELECT status FROM leads WHERE name='Novo'").get().status,
    "PENDING",
  );
  f.db.close();
});
test("recibos são necessários para entrega e leitura, nunca deduzidos do envio", async () => {
  const f = fixture({ count: 1 }),
    c = f.create();
  await f.drain(c.id);
  assert.equal(f.campaigns.get(c.id).delivered, 0);
  const providerId = f.calls[0].args[2];
  f.dispatcher.receipt(providerId, "READ");
  assert.equal(f.campaigns.get(c.id).read, 1);
  f.dispatcher.receipt(providerId, "SENT");
  assert.equal(f.campaigns.get(c.id).read, 1);
  f.db.close();
});
test("restrição de conta persiste além de 24h e exige revisão mais continuação", async () => {
  const f = fixture({ count: 3 }),
    c = f.create();
  await f.step();
  f.dispatcher.restrictAccount(
    "Restrição por 24h",
    new Date(f.now() + 86400000).toISOString(),
    "tester",
  );
  assert.throws(() => f.dispatcher.releaseAccount("revisão", "tester"));
  f.advance(90000000);
  f.connect(false);
  f.connect(true);
  f.dispatcher.recover();
  await f.step();
  assert.equal(f.calls.length, 1);
  assert.equal(f.campaigns.get(c.id).execution_status, "ACCOUNT_RESTRICTED");
  assert.throws(() => command(f, c, "resume"));
  f.dispatcher.releaseAccount("Revisto no painel do provedor", "tester");
  await f.step();
  assert.equal(f.calls.length, 1);
  command(f, c, "resume");
  await f.step();
  assert.equal(f.calls.length, 2);
  f.db.close();
});

test("mudança de telefone não transfere autorização ou janela, e conserva recusa explícita", () => {
  const f = fixture({ count: 1 }),
    leads = new Leads(f.db, { now: f.now });
  let lead = leads.update("lead000000", { phone: "+5511999991234" }, "tester");
  assert.equal(lead.status, "PENDING");
  assert.equal(lead.last_inbound_at, null);
  assert.equal(lead.consent_method, "IDENTITY_CHANGE");
  consent(
    f.db,
    lead.id,
    "OPT_OUT",
    { source: "TEST", reason: "Recusa" },
    f.now(),
  );
  assert.throws(
    () =>
      leads.update(
        lead.id,
        {
          phone: "+5511999991235",
          status: "OPT_IN",
          consentEvidence: true,
          consentReason: "Sem reconfirmação",
        },
        "tester",
      ),
    (e) => e.status === 409,
  );
  assert.equal(leads.get(lead.id).phone, "5511999991234");
  assert.equal(leads.get(lead.id).status, "OPT_OUT");
  f.db.close();
});
test("seleção malformada não amplia audiência silenciosamente", () => {
  const f = fixture({ count: 2 });
  for (const selection of [
    { type: "id", ids: ["lead000000"] },
    { type: "filters", excludedIds: "lead000000" },
    { type: "filters", filters: [] },
    { type: "ids", ids: [null] },
  ])
    assert.throws(
      () => f.campaigns.audience(selection),
      (e) => e.status === 400,
    );
  f.db.close();
});
test("recibo durante chamada mantém pausa solicitada até retorno real", async () => {
  let resolve;
  const f = fixture({
      count: 2,
      send: () => new Promise((r) => (resolve = r)),
    }),
    c = f.create();
  const pending = f.dispatcher.tick();
  await new Promise(setImmediate);
  f.dispatcher.receipt(f.calls[0].args[2], "DELIVERED");
  command(f, c, "pause");
  assert.equal(f.campaigns.get(c.id).execution_status, "PAUSE_REQUESTED");
  assert.equal(f.campaigns.get(c.id).inFlight, 1);
  resolve({ success: true });
  await pending;
  assert.equal(f.campaigns.get(c.id).execution_status, "PAUSED");
  assert.equal(f.campaigns.get(c.id).delivered, 1);
  f.db.close();
});

test("campanha criada durante restrição também exige revisão e continuação manual", async () => {
  const f = fixture({ count: 1 });
  f.dispatcher.restrictAccount("Restrição da conta");
  const c = f.create();
  assert.equal(c.execution_status, "ACCOUNT_RESTRICTED");
  assert.equal(c.manual_paused, 1);
  f.dispatcher.releaseAccount("Revisão", "tester");
  await f.step();
  assert.equal(f.calls.length, 0);
  command(f, c, "resume");
  await f.step();
  assert.equal(f.calls.length, 1);
  f.db.close();
});
test("opt-out atrás de outras entradas é processado antes do destinatário pendente", async () => {
  const f = fixture({ count: 101 }),
    c = f.create({ selection: { type: "ids", ids: ["lead000100"] } });
  for (let i = 0; i < 101; i++) {
    const lead = f.db
      .prepare("SELECT * FROM leads WHERE id=?")
      .get("lead" + String(i).padStart(6, "0"));
    f.flows.receive({
      msgId: "burst-" + i,
      remoteJid: lead.phone + "@s.whatsapp.net",
      phone: "+" + lead.phone,
      text: i === 100 ? "SAIR" : "Olá",
    });
  }
  await f.step(5);
  assert.equal(f.campaigns.get(c.id).counts.SKIPPED, 1);
  assert.equal(
    f.calls.filter((x) => x.args[1].text.startsWith("Olá Pessoa")).length,
    0,
  );
  f.db.close();
});
