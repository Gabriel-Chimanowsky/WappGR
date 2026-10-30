const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { fixture } = require("./helpers.cjs");
const { CloudApiAdapter } = require("../server/cloud-api");
const official = require("../server/official-policy");
const { Dispatcher } = require("../server/dispatcher");
const { validateFlow } = require("../server/flows");
const { createApp } = require("../server/app");
const { createAdmin } = require("../server/auth");
function setup(options = {}) {
  const f = fixture({ count: 3, ...options }),
    sent = [];
  let templates = official
    .catalog(f.db)
    .map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components,
    }));
  const adapter = new CloudApiAdapter({
    db: f.db,
    now: f.now,
    phoneNumberId: "12345",
    wabaId: "67890",
    version: "v99.0",
    token: "SYNTHETIC_ONLY",
    appSecret: "app-secret-test",
    verifyToken: "verify-token-test",
    fetchImpl: async (url, opts) => {
      if (opts?.method === "POST") {
        sent.push(JSON.parse(opts.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [{ id: "wamid.synthetic." + sent.length }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("message_templates")
            ? { data: templates }
            : url.includes("phone_numbers")
              ? { data: [{ id: "12345" }] }
              : { id: "12345", display_phone_number: "synthetic" },
      };
    },
  });
  f.provider = adapter;
  f.dispatcher.provider = adapter;
  f.dispatcher.beforeDispatch = (leadId) => {
    adapter.processEvents(f.dispatcher, f.flows);
    f.flows.tick(leadId);
  };
  return Object.assign(f, {
    sent,
    setTemplates: (ts) => {
      templates = ts;
    },
    templates: () => templates,
  });
}
function webhook(f, value, field = "messages") {
  const raw = Buffer.from(
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "67890",
          changes: [
            {
              field,
              value: { metadata: { phone_number_id: "12345" }, ...value },
            },
          ],
        },
      ],
    }),
  );
  return {
    raw,
    signature:
      "sha256=" +
      createHmac("sha256", "app-secret-test").update(raw).digest("hex"),
  };
}
function incoming(
  f,
  { id = "in-1", phone = "5511900000000", text = "Oi", at = f.now() } = {},
) {
  const event = webhook(f, {
    messages: [
      {
        id,
        from: phone,
        timestamp: String(Math.floor(at / 1000)),
        type: "text",
        text: { body: text },
      },
    ],
  });
  f.provider.acceptWebhook(event.raw, event.signature);
  f.provider.processEvents(f.dispatcher, f.flows);
  f.flows.tick();
}
test("categoria: enum único, rascunho incompleto, backend exige categoria ao executar cada módulo", () => {
  const f = setup();
  assert.deepEqual(
    official.categories.map((c) => c.value),
    ["SERVICE", "UTILITY", "MARKETING"],
  );
  for (const value of [
    undefined,
    "AUTO",
    "OTHER",
    "AUTHENTICATION",
    ["SERVICE", "UTILITY"],
    "service",
  ])
    assert.throws(
      () =>
        f.campaigns.create(
          { title: "Invalid", message: "Oi", messageCategory: value },
          randomUUID(),
        ),
      (e) => ["CATEGORY_REQUIRED", "CATEGORY_INVALID"].includes(e.code),
    );
  const draft = f.campaigns.create(
    { title: "Rascunho", startMode: "DRAFT" },
    "draft",
  ).campaign;
  assert.equal(draft.message_category, null);
  assert.throws(
    () => f.campaigns.control(draft.id, "start", {}, "start", "test"),
    /Categoria/,
  );
  assert.throws(
    () => f.scheduler.create({ title: "Regra", timeOfDay: "09:00" }),
    /Categoria/,
  );
  assert.throws(
    () =>
      validateFlow(
        { name: "Fluxo", active: true, steps: [{ id: "one", type: "TEXT" }] },
        f.db,
        f.now(),
      ),
    /Categoria/,
  );
  const rule = f.scheduler.create({
    title: "Rascunho",
    timeOfDay: "09:00",
    active: false,
  });
  assert.equal(rule.active, 0);
  assert.equal(rule.message_category, null);
  f.db.close();
});
test("fluxo: categoria herdada, substituição explícita e revisão de modelos compatíveis", () => {
  const f = setup(),
    body = {
      name: "Misto",
      messageCategory: "MARKETING",
      active: true,
      steps: [
        {
          id: "first",
          type: "TEXT",
          template: f.messageConfig.template,
          options: [{ label: "Atender", keyword: "1", nextStepId: "reply" }],
        },
        {
          id: "reply",
          type: "TEXT",
          content: "Como ajudar?",
          messageCategory: "SERVICE",
          overrideCategory: true,
        },
      ],
    };
  const steps = validateFlow(body, f.db, f.now());
  assert.equal(steps[0].messageCategory, null);
  assert.equal(steps[0].type, "TEMPLATE");
  assert.equal(steps[0].template.approvedCategory, "MARKETING");
  assert.equal(steps[1].messageCategory, "SERVICE");
  assert.equal(steps[1].type, "TEXT");
  assert.throws(
    () =>
      validateFlow(
        {
          ...body,
          steps: [
            {
              ...body.steps[0],
              options: [],
              overrideCategory: true,
              messageCategory: "",
            },
          ],
        },
        f.db,
        f.now(),
      ),
    /Categoria/,
  );
  assert.throws(
    () =>
      official.validateMessage(
        f.db,
        { ...f.messageConfig, messageCategory: "UTILITY" },
        { now: f.now() },
      ),
    (e) => e.code === "CATEGORY_MISMATCH",
  );
  f.db.close();
});
test("catálogo: sincronização paginada, cache, pausa/rejeição/remoção/reclassificação suspende sem alterar intenção", async () => {
  for (const condition of [
    "PAUSED",
    "REJECTED",
    "DISABLED",
    "MISSING",
    "RECLASSIFIED",
    "CONTENT",
  ]) {
    const f = setup(),
      c = f.create();
    let template = { ...f.templates()[0] };
    if (condition === "RECLASSIFIED") template.category = "UTILITY";
    else if (condition === "CONTENT")
      template.components = [{ type: "BODY", text: "Conteúdo alterado {{1}}" }];
    else template.status = condition;
    f.setTemplates(condition === "MISSING" ? [] : [template]);
    await f.provider.syncTemplates();
    const revised = f.campaigns.get(c.id);
    assert.equal(revised.execution_status, "REVIEW_REQUIRED", condition);
    assert.equal(revised.message_category, "MARKETING");
    assert.equal(revised.messageConfig.template.approvedCategory, "MARKETING");
    assert.ok(
      f.db.prepare("SELECT COUNT(*) n FROM cloud_template_history").get().n,
    );
    await f.step();
    assert.equal(f.sent.length, 0);
    assert.throws(
      () => f.campaigns.control(c.id, "resume", {}, "resume", "test"),
      /Revise/,
    );
    f.db.close();
  }
  const f = setup();
  let pages = 0;
  f.provider.fetch = async (url) => {
    pages++;
    return {
      ok: true,
      json: async () =>
        url.includes("after=second")
          ? { data: [] }
          : {
              data: f.templates(),
              paging: {
                next: "https://graph.facebook.com/ignored?access_token=never-follow",
                cursors: { after: "second" },
              },
            },
    };
  };
  await f.provider.syncTemplates();
  assert.equal(pages, 2);
  f.advance(official.TEMPLATE_TTL_MS);
  assert.throws(
    () => official.validateMessage(f.db, f.messageConfig, { now: f.now() }),
    (e) => e.code === "TEMPLATE_STALE",
  );
  f.db.close();
});
test("Serviço: janela individual, limite exato, empresa e histórico Baileys não abrem a janela", async () => {
  const f = setup();
  f.db.prepare("UPDATE leads SET cloud_last_inbound_at=NULL").run();
  incoming(f, { at: f.now() - 86400000 });
  incoming(f, { id: "recent", phone: "5511900000001", at: f.now() - 1000 });
  const p = f.campaigns.preview({ messageCategory: "SERVICE" });
  assert.equal(p.eligible, 1);
  assert.equal(p.reasons.outsideWindow, 2);
  const c = f.create({ messageCategory: "SERVICE", template: null });
  await f.step();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, "5511900000001");
  assert.equal(f.sent[0].type, "text");
  assert.equal(f.sent[0].messageCategory, undefined);
  assert.equal(f.sent[0].category, undefined);
  const at = f.db
    .prepare("SELECT cloud_last_inbound_at FROM leads WHERE id='lead000001'")
    .get().cloud_last_inbound_at;
  f.advance(86400000);
  assert.equal(
    official.windowOpen({ cloud_last_inbound_at: at }, f.now()),
    false,
  );
  assert.equal(f.campaigns.get(c.id).delivered, 0);
  f.db.close();
});
test("Serviço: expira após espera, pausa, reinício e preparação de mídia; sessão aguarda nova entrada sem loop", async () => {
  const f = setup({ count: 2 });
  const c = f.create({ messageCategory: "SERVICE", template: null });
  await f.step();
  f.campaigns.control(c.id, "pause", {}, "pause", "test");
  f.advance(86400000);
  const recovered = new Dispatcher(f.db, f.campaigns, f.provider, {
    now: f.now,
  });
  recovered.recover();
  f.campaigns.control(c.id, "resume", {}, "resume", "test");
  await recovered.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.campaigns.recipients(c.id).rows[1].status, "SKIPPED");
  assert.match(f.campaigns.recipients(c.id).rows[1].error, /WINDOW_EXPIRED/);
  const lead = f.db.prepare("SELECT * FROM leads WHERE id='lead000000'").get();
  const flow = {
    id: "waiting",
    name: "Waiting",
    active: 1,
    message_category: "SERVICE",
    steps_json: JSON.stringify([
      { id: "s", type: "TEXT", content: "Ajuda", delaySeconds: 0 },
    ]),
    updated_at: new Date(f.now()).toISOString(),
  };
  f.db
    .prepare(
      "INSERT INTO flows(id,name,active,message_category,steps_json,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      flow.id,
      flow.name,
      1,
      flow.message_category,
      flow.steps_json,
      flow.updated_at,
    );
  f.flows.start(lead, flow);
  for (let i = 0; i < 3; i++) await f.step();
  assert.equal(
    f.db.prepare("SELECT status FROM lead_flow_sessions").get().status,
    "WAITING_CUSTOMER",
  );
  assert.equal(f.sent.length, 1);
  incoming(f, { id: "reopen" });
  await f.step();
  assert.equal(f.sent.length, 2);
  const hosts = process.env.WAPPGR_MEDIA_HOSTS;
  process.env.WAPPGR_MEDIA_HOSTS = "media.test";
  try {
    incoming(f, { id: "media-window" });
    const build = f.provider.buildMessage.bind(f.provider);
    f.provider.buildMessage = (...args) => {
      const result = build(...args);
      f.advance(86400000);
      return result;
    };
    const result = await f.provider.send(
      lead.phone,
      { type: "IMAGE", text: "Imagem", mediaUrl: "https://media.test/a.png" },
      "media",
      {
        messageConfig: {
          messageCategory: "SERVICE",
          type: "IMAGE",
          mediaUrl: "https://media.test/a.png",
        },
        getLead: () =>
          f.db.prepare("SELECT * FROM leads WHERE id=?").get(lead.id),
      },
    );
    assert.equal(result.code, "WINDOW_EXPIRED");
    assert.equal(result.definitelyNotSent, true);
    assert.equal(f.sent.length, 2);
  } finally {
    if (hosts === undefined) delete process.env.WAPPGR_MEDIA_HOSTS;
    else process.env.WAPPGR_MEDIA_HOSTS = hosts;
    f.db.close();
  }
});
test("webhook HTTP: assinatura bruta, token distinto, persistência antes do ACK, deduplicação e processamento sem sessão", async (t) => {
  const f = setup();
  f.db.prepare("UPDATE leads SET cloud_last_inbound_at=NULL").run();
  const server = createApp({ ...f }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    f.db.close();
  });
  const url =
    "http://127.0.0.1:" + server.address().port + "/api/webhooks/whatsapp";
  assert.equal(
    (
      await fetch(
        url +
          "?hub.mode=subscribe&hub.verify_token=app-secret-test&hub.challenge=42",
      )
    ).status,
    403,
  );
  assert.equal(
    await (
      await fetch(
        url +
          "?hub.mode=subscribe&hub.verify_token=verify-token-test&hub.challenge=42",
      )
    ).text(),
    "42",
  );
  const e = webhook(f, {
    messages: [
      {
        id: "http",
        from: "5511900000000",
        type: "text",
        text: { body: "Oi" },
        timestamp: String(f.now() / 1000),
      },
    ],
  });
  const post = (body, sig) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": sig,
      },
      body,
    });
  assert.equal((await post(e.raw, "sha256=bad")).status, 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM cloud_events").get().n, 0);
  assert.equal((await post(e.raw, e.signature)).status, 200);
  assert.equal(
    f.db.prepare("SELECT status FROM cloud_events").get().status,
    "PENDING",
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
  assert.equal((await post(e.raw, e.signature)).status, 200);
  f.provider.processEvents(f.dispatcher, f.flows);
  f.flows.tick();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM cloud_events").get().n, 1);
  assert.ok(
    f.db
      .prepare("SELECT cloud_last_inbound_at FROM leads WHERE id='lead000000'")
      .get().cloud_last_inbound_at,
  );
  const broken = f.provider.acceptWebhook;
  f.provider.acceptWebhook = () => {
    throw Error("Simulated durable write failure");
  };
  assert.equal((await post(e.raw, e.signature)).status, 500);
  f.provider.acceptWebhook = broken;
});
test("IDs oficiais: aceite sem entrega, recibos repetidos/fora de ordem, cobrança e resultado incerto sem duplicação", async () => {
  const f = setup({ count: 1 }),
    c = f.create();
  await f.step();
  let m = f.db.prepare("SELECT * FROM messages").get();
  assert.equal(m.status, "SENT");
  assert.equal(m.provider_status, "ACCEPTED");
  assert.equal(m.delivered_at, null);
  assert.equal(m.whatsapp_msg_id, "wamid.synthetic.1");
  assert.equal(m.intended_category, "MARKETING");
  assert.equal(m.approved_category, "MARKETING");
  assert.equal(m.sent_format, "TEMPLATE");
  assert.equal(f.sent[0].template.name, "aviso_sintetico");
  assert.equal(f.sent[0].template.category, undefined);
  assert.equal(f.sent[0].category, undefined);
  const receive = (state) =>
    f.dispatcher.cloudReceipt({
      id: m.whatsapp_msg_id,
      status: state,
      recipient_id: m.lead_phone,
      timestamp: String(f.now() / 1000),
      pricing: { billable: true, category: "marketing", pricing_model: "PMP" },
    });
  receive("read");
  receive("sent");
  receive("delivered");
  receive("read");
  receive("failed");
  m = f.db.prepare("SELECT * FROM messages").get();
  assert.equal(m.status, "READ");
  assert.equal(m.provider_status, "READ");
  assert.match(m.pricing_json, /marketing/);
  assert.equal(f.campaigns.get(c.id).read, 1);
  const u = f.create();
  f.provider.fetch = async () => {
    throw Error("timeout");
  };
  await f.step();
  f.advance(60000);
  await f.step(3);
  assert.equal(f.campaigns.get(u.id).counts.UNCERTAIN, 1);
  assert.equal(f.campaigns.get(u.id).attempts, 1);
  const uncertain = f.db
    .prepare("SELECT * FROM messages WHERE status='UNCERTAIN'")
    .get();
  assert.equal(uncertain.whatsapp_msg_id, null);
  assert.equal(
    f.dispatcher.cloudReceipt({
      id: "wamid.late",
      biz_opaque_callback_data: uncertain.correlation_id,
      status: "delivered",
      recipient_id: uncertain.lead_phone,
    }),
    true,
  );
  assert.equal(
    f.db.prepare("SELECT status FROM messages WHERE id=?").get(uncertain.id)
      .status,
    "DELIVERED",
  );
  assert.equal(f.campaigns.get(u.id).attempts, 1);
  f.db.close();
});
test("recibo antes da resposta associa o ID oficial e falha não regride confirmação de entrega", async () => {
  const f = setup({ count: 1 });
  let finish;
  f.provider.fetch = async (url, options) => {
    if (options?.method !== "POST")
      return { ok: true, json: async () => ({ data: f.templates() }) };
    const body = JSON.parse(options.body);
    assert.equal(
      f.dispatcher.cloudReceipt({
        id: "wamid.early",
        biz_opaque_callback_data: body.biz_opaque_callback_data,
        recipient_id: body.to,
        status: "read",
      }),
      true,
    );
    return new Promise((resolve) => {
      finish = () =>
        resolve({
          ok: true,
          json: async () => ({ messages: [{ id: "wamid.early" }] }),
        });
    });
  };
  const c = f.create(),
    pending = f.dispatcher.tick();
  await new Promise(setImmediate);
  assert.equal(f.campaigns.get(c.id).read, 1);
  finish();
  await pending;
  assert.equal(f.campaigns.get(c.id).read, 1);
  assert.equal(
    f.db.prepare("SELECT provider_status FROM messages").get().provider_status,
    "READ",
  );
  f.db.close();
});
test("custos sintéticos: desconhecido não vira zero, versão/fonte/data e orçamento bloqueiam antes da chamada", async () => {
  const f = setup({ count: 2 });
  const unknown = f.campaigns.preview({
    ...f.messageConfig,
    maxBudget: 1,
    currency: "BRL",
  });
  assert.equal(unknown.cost.total, null);
  assert.equal(unknown.cost.available, false);
  assert.equal(unknown.cost.label, "Estimativa indisponível");
  const rate = {
    currency: "BRL",
    source: "https://example.invalid/synthetic-rate-card",
    effectiveAt: new Date(f.now() - 1000).toISOString(),
    expiresAt: new Date(f.now() + 86400000).toISOString(),
    rates: [
      { prefix: "55", category: "MARKETING", amount: 0.75 },
      { prefix: "55", category: "SERVICE", amount: 0.2 },
      { prefix: "55", category: "UTILITY", amount: 0.5 },
    ],
  };
  official.saveRates(f.db, rate, f.now());
  let preview = f.campaigns.preview({
    ...f.messageConfig,
    maxBudget: 1,
    currency: "BRL",
  });
  assert.equal(preview.cost.total, 1.5);
  assert.ok(preview.cost.rateVersion);
  assert.match(preview.budgetReason, /BUDGET_EXCEEDED/);
  const c = f.create({ maxBudget: 1, currency: "BRL" });
  await f.step();
  assert.equal(f.sent.length, 0);
  assert.equal(f.campaigns.get(c.id).execution_status, "BUDGET_SUSPENDED");
  assert.equal(
    f.campaigns.preview({ messageCategory: "SERVICE" }).cost.total,
    0.4,
  );
  official.saveRates(f.db, { ...rate, freeServiceWindow: true }, f.now() + 1);
  assert.equal(
    f.campaigns.preview({ messageCategory: "SERVICE" }).cost.total,
    0,
  );
  f.advance(86400000);
  await f.provider.syncTemplates();
  assert.equal(f.campaigns.preview(f.messageConfig).cost.available, false);
  f.db.close();
});

test("falha oficial antes do aceite HTTP prevalece e não permite nova tentativa automática", async () => {
  for (const kind of ["campaign", "chat"]) {
    const f = setup({ count: 1 });
    f.provider.fetch = async (url, options) => {
      if (options?.method !== "POST")
        return { ok: true, json: async () => ({ data: f.templates() }) };
      const body = JSON.parse(options.body);
      assert.equal(
        f.dispatcher.cloudReceipt({
          id: "wamid.failed",
          biz_opaque_callback_data: body.biz_opaque_callback_data,
          recipient_id: body.to,
          status: "failed",
          errors: [{ code: 131049 }],
        }),
        true,
      );
      return {
        ok: true,
        json: async () => ({ messages: [{ id: "wamid.failed" }] }),
      };
    };
    if (kind === "campaign") f.create();
    else
      f.dispatcher.enqueue({
        lead: f.db.prepare("SELECT * FROM leads WHERE id='lead000000'").get(),
        kind: "HUMAN_REPLY",
        payload: { type: "TEXT", text: "Atendimento" },
        jobId: "early-failure",
      });
    await f.step();
    const message = f.db.prepare("SELECT * FROM messages").get();
    assert.equal(message.status, "FAILED");
    assert.equal(message.provider_status, "FAILED");
    assert.match(message.error, /PLATFORM_LIMIT/);
    const item = f.db
      .prepare(
        "SELECT * FROM " +
          (kind === "campaign" ? "campaign_recipients" : "outbound_jobs"),
      )
      .get();
    assert.equal(item.status, "FAILED");
    assert.match(item.error, /PLATFORM_LIMIT/);
    f.advance(60000);
    await f.step();
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
    f.db.close();
  }
});

test("configuração administrativa: autenticação, CSRF, segredo recusado e identidade vinculada", async (t) => {
  const f = setup();
  createAdmin(f.db, "cloud-admin", "senha-isolada-cloud");
  const server = createApp({ ...f }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    f.db.close();
  });
  const root = "http://127.0.0.1:" + server.address().port + "/api/v1";
  const request = (route, method = "GET", body, headers = {}) =>
    fetch(root + route, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal((await request("/cloud/config")).status, 401);
  const login = await request("/auth/login", "POST", {
    username: "cloud-admin",
    password: "senha-isolada-cloud",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0],
    session = await login.json(),
    headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
  const body = { phoneNumberId: "12345", wabaId: "67890", version: "v99.0" };
  assert.equal(
    (await request("/cloud/config", "POST", body, { Cookie: cookie })).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/cloud/config",
        "POST",
        { ...body, token: "must-not-store" },
        headers,
      )
    ).status,
    400,
  );
  const saved = await request("/cloud/config", "POST", body, headers);
  assert.equal(saved.status, 200);
  const publicJson = await saved.text();
  for (const secret of [
    "SYNTHETIC_ONLY",
    "app-secret-test",
    "verify-token-test",
    "must-not-store",
  ])
    assert.ok(!publicJson.includes(secret));
  assert.equal((await request("/cloud/test", "POST", {}, headers)).status, 200);
  assert.equal(f.sent.length, 0);
  f.provider.overrides.phoneNumberId = "55555";
  assert.throws(
    () => f.provider.bindAccount(),
    (e) => e.code === "ACCOUNT_MISMATCH",
  );
  assert.ok(
    !JSON.stringify(f.db.prepare("SELECT * FROM settings").all()).includes(
      "must-not-store",
    ),
  );
});

test("áudio: Graph sem legenda; fluxo envia acompanhamento em texto separado", async () => {
  const f = setup({ count: 1 }),
    previous = process.env.WAPPGR_MEDIA_HOSTS;
  process.env.WAPPGR_MEDIA_HOSTS = "media.test";
  try {
    assert.throws(
      () =>
        f.campaigns.create(
          {
            title: "Áudio",
            messageCategory: "SERVICE",
            type: "AUDIO",
            message: "Legenda não aceita",
            mediaUrl: "https://media.test/clip.ogg",
          },
          "audio",
        ),
      /não aceita legenda/,
    );
    const flow = {
      name: "Áudio",
      active: true,
      messageCategory: "SERVICE",
      steps: [
        {
          id: "a",
          type: "AUDIO",
          content: "Escolha atendimento",
          mediaUrl: "https://media.test/clip.ogg",
          options: [{ label: "Atender", keyword: "1", nextStepId: "" }],
        },
      ],
    };
    assert.throws(
      () => validateFlow(flow, f.db, f.now()),
      /etapa de texto após o áudio/,
    );
    const steps = validateFlow(
      { ...flow, steps: [{ ...flow.steps[0], options: [] }] },
      f.db,
      f.now(),
    );
    f.db
      .prepare(
        "INSERT INTO flows(id,name,active,message_category,steps_json,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "audio",
        "Áudio",
        1,
        "SERVICE",
        JSON.stringify(steps),
        new Date(f.now()).toISOString(),
      );
    f.flows.start(
      f.db.prepare("SELECT * FROM leads").get(),
      f.db.prepare("SELECT * FROM flows").get(),
    );
    await f.step(4);
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[0].type, "audio");
    assert.equal(f.sent[0].audio.caption, undefined);
    assert.equal(f.sent[1].type, "text");
    assert.match(f.sent[1].text.body, /Escolha atendimento/);
  } finally {
    if (previous === undefined) delete process.env.WAPPGR_MEDIA_HOSTS;
    else process.env.WAPPGR_MEDIA_HOSTS = previous;
    f.db.close();
  }
});
test("migração v2 para v3: backup WAL íntegro, histórico e restrição preservados, nenhuma retomada automática", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-cloud-migration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "legacy.db"),
    f = fixture({ filename, count: 2 });
  const c = f.create({ messageCategory: "SERVICE", template: null });
  await f.step();
  f.db
    .prepare("INSERT INTO flows(id,name,active) VALUES('old-flow','Old',1)")
    .run();
  f.scheduler.create({
    title: "Old schedule",
    message: "Oi",
    messageCategory: "SERVICE",
    timeOfDay: "10:00",
  });
  f.dispatcher.restrictAccount("Restrição real preservada");
  // Reconstruct the v2 schema only in this isolated synthetic DB.
  for (const table of [
    "cloud_templates",
    "cloud_template_history",
    "cloud_events",
    "cloud_message_links",
    "cloud_rates",
    "configuration_history",
  ])
    f.db.exec("DROP TABLE " + table);
  f.db.exec("DROP INDEX idx_messages_correlation");
  const fields = {
    campaigns: [
      "message_category",
      "message_config_json",
      "review_required",
      "reviewed_at",
    ],
    flows: [
      "message_category",
      "message_config_json",
      "review_required",
      "reviewed_at",
    ],
    schedules: [
      "message_category",
      "message_config_json",
      "review_required",
      "reviewed_at",
      "reason",
    ],
    leads: ["cloud_last_inbound_at"],
    lead_flow_sessions: ["reason"],
    messages: [
      "provider",
      "intended_category",
      "approved_category",
      "sent_format",
      "configuration_json",
      "pricing_json",
      "correlation_id",
      "provider_status",
    ],
    outbound_jobs: [
      "provider",
      "intended_category",
      "approved_category",
      "sent_format",
      "configuration_json",
      "pricing_json",
      "provider_status",
    ],
    campaign_recipients: ["provider_status"],
  };
  for (const [table, names] of Object.entries(fields))
    for (const name of names)
      f.db.exec("ALTER TABLE " + table + " DROP COLUMN " + name);
  f.db.exec(
    "ALTER TABLE messages DROP COLUMN estimate_json; DELETE FROM schema_migrations WHERE version=3",
  );
  f.db.close();
  const db = require("../server/db").openDatabase(filename);
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    db.prepare("SELECT restricted FROM account_control").get().restricted,
    1,
  );
  assert.equal(db.prepare("SELECT active FROM flows").get().active, 0);
  assert.equal(db.prepare("SELECT active FROM schedules").get().active, 0);
  assert.equal(
    db.prepare("SELECT message_category FROM campaigns WHERE id=?").get(c.id)
      .message_category,
    null,
  );
  assert.equal(
    db.prepare("SELECT execution_status FROM campaigns WHERE id=?").get(c.id)
      .execution_status,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    db.prepare("SELECT provider FROM messages").get().provider,
    "BAILEYS",
  );
  const backup = fs
    .readdirSync(path.join(dir, "backups"))
    .find((p) => p.startsWith("before-v3"));
  assert.ok(backup);
  const saved = new (require("../server/sqlite"))(
    path.join(dir, "backups", backup),
    { readonly: true },
  );
  assert.equal(
    saved.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(
    saved.prepare("SELECT MAX(version) v FROM schema_migrations").get().v,
    2,
  );
  assert.equal(saved.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  saved.close();
  const campaigns = new (require("../server/campaigns").Campaigns)(db, {
      now: f.now,
    }),
    dispatcher = new Dispatcher(
      db,
      campaigns,
      {
        getStatus: () => ({ status: "CONNECTED" }),
        send: () => {
          throw Error("MIGRATION MUST NOT SEND");
        },
      },
      { now: f.now },
    );
  dispatcher.recover();
  await dispatcher.tick();
  assert.equal(campaigns.get(c.id).execution_status, "REVIEW_REQUIRED");
  db.close();
});
test("inicialização oficial não carrega Baileys, sockets ou QR e preserva credenciais antigas", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wappgr-official-start-")),
    config = {
      root: path.resolve("."),
      filename: path.join(dir, "test.db"),
      authDir: path.join(dir, "auth"),
      runtimeDir: path.join(dir, "runtime"),
      logsDir: path.join(dir, "logs"),
      healthFile: path.join(dir, "health.json"),
      host: "127.0.0.1",
      port: 0,
    };
  fs.mkdirSync(config.authDir);
  fs.writeFileSync(
    path.join(config.authDir, "creds.json"),
    "synthetic-sentinel",
  );
  const before = Object.keys(require.cache).filter((k) =>
    k.endsWith(path.sep + "baileys.js"),
  );
  const backend = await require("../server/backend").startBackend({ config });
  t.after(async () => {
    await backend.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(backend.provider.getStatus().transport, "CLOUD_API");
  assert.equal(backend.provider.getStatus().qrCode, undefined);
  assert.deepEqual(
    Object.keys(require.cache).filter((k) =>
      k.endsWith(path.sep + "baileys.js"),
    ),
    before,
  );
  assert.equal(
    fs.readFileSync(path.join(config.authDir, "creds.json"), "utf8"),
    "synthetic-sentinel",
  );
});
