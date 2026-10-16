const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { fixture } = require("./helpers.cjs");
const { createApp } = require("../server/app");
const { createAdmin } = require("../server/auth");
test("API protegida, CSRF/CORS, webhook desabilitado, idempotência e simuladores isolados", async (t) => {
  const f = fixture({ count: 1 });
  createAdmin(f.db, "teste", "senha-local-de-teste");
  const app = createApp({ ...f, origins: ["http://localhost:5173"] });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    f.db.close();
  });
  const root = "http://127.0.0.1:" + server.address().port + "/api/v1";
  const req = (p, method = "GET", body, headers = {}) =>
    fetch(root + p, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json", ...headers },
    });
  assert.equal((await req("/leads")).status, 401);
  assert.equal((await req("/connection/qrcode")).status, 401);
  assert.equal(
    (
      await req("/crm/webhook/lead", "POST", {
        name: "X",
        phone: "11999999999",
      })
    ).status,
    503,
  );
  const login = await req("/auth/login", "POST", {
    username: "teste",
    password: "senha-local-de-teste",
  });
  assert.equal(login.status, 200);
  const session = await login.json(),
    cookie = login.headers.get("set-cookie").split(";")[0],
    h = { Cookie: cookie, "X-CSRF-Token": session.csrf };
  const connection = await (
    await req("/connection/status", "GET", null, h)
  ).json();
  assert.equal(connection.transport, "BAILEYS");
  assert.equal(connection.cloudApiPrepared, undefined);
  assert.equal(
    (
      await req(
        "/leads",
        "POST",
        { name: "x", phone: "11988888888" },
        { Cookie: cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req("/leads", "GET", null, {
        ...h,
        Origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await req("/categories/cleanup-empty", "GET", null, h)).status,
    404,
  );
  const before = f.db.prepare("SELECT COUNT(*) n FROM leads").get().n;
  assert.equal(
    (await req("/optin/process-message", "POST", { messageText: "SIM" }, h))
      .status,
    200,
  );
  assert.equal(
    (
      await req(
        "/crm/simulate",
        "POST",
        { name: "Simulação", phone: "11988888888" },
        h,
      )
    ).status,
    200,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM leads").get().n, before);
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM outbound_jobs").get().n, 0);
  const body = { title: "API", message: "Oi", batchSize: 40 },
    headers = { ...h, "Idempotency-Key": "http-duplicate" };
  const first = await (
      await req("/campaigns/send", "POST", body, headers)
    ).json(),
    again = await (await req("/campaigns/send", "POST", body, headers)).json();
  assert.equal(first.campaign.id, again.campaign.id);
  assert.equal(
    (
      await req(
        "/campaigns/send",
        "POST",
        { ...body, message: "Diferente" },
        headers,
      )
    ).status,
    409,
  );
  const keyResult = await (await req("/crm/rotate-key", "POST", {}, h)).json();
  assert.ok(keyResult.apiKey);
  assert.equal(
    (await (await req("/crm/config", "GET", null, h)).json()).apiKey,
    undefined,
  );
  assert.equal(
    (
      await req("/crm/webhook/lead", "POST", {
        name: "Sem chave",
        phone: "11988888888",
      })
    ).status,
    401,
  );
});

test("API: proteção de todos os módulos, webhook preserva opt-out e métricas distinguem falha/envio/entrega", async (t) => {
  const { consent } = require("../server/policy");
  const f = fixture({ count: 2 });
  createAdmin(f.db, "metrics-test", "senha-local-de-teste");
  const app = createApp({ ...f }),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    f.db.close();
  });
  const root = "http://127.0.0.1:" + server.address().port + "/api/v1";
  const req = (path, method = "GET", body, headers = {}) =>
    fetch(root + path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    });
  for (const [path, method] of [
    ["/campaigns", "GET"],
    ["/campaigns/send", "POST"],
    ["/schedules", "POST"],
    ["/flows/fake/trigger-lead", "POST"],
    ["/connection/start", "POST"],
    ["/connection/logout", "POST"],
    ["/crm/config", "GET"],
    ["/chat/send", "POST"],
  ])
    assert.equal(
      (await req(path, method, method === "GET" ? undefined : {})).status,
      401,
      path,
    );
  const login = await req("/auth/login", "POST", {
      username: "metrics-test",
      password: "senha-local-de-teste",
    }),
    session = await login.json(),
    headers = {
      Cookie: login.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": session.csrf,
    };
  assert.equal((await req("/leads", "POST", [], headers)).status, 400);
  const key = await (await req("/crm/rotate-key", "POST", {}, headers)).json();
  consent(
    f.db,
    "lead000001",
    "OPT_OUT",
    { source: "TEST", reason: "Recusa" },
    f.now(),
  );
  const hook = await req(
    "/crm/webhook/lead",
    "POST",
    {
      phone: "+5511900000001",
      name: "Webhook sintético",
      optInConfirmed: true,
      consentEvidence: "Autorização alegada pelo integrador",
    },
    { "x-api-key": key.apiKey },
  );
  assert.equal(hook.status, 200);
  assert.equal((await hook.json()).lead.status, "OPT_OUT");
  const c = f.create();
  await f.drain(c.id);
  let stats = await (
    await req("/dashboard/stats", "GET", undefined, headers)
  ).json();
  assert.equal(stats.totalSent, 1);
  assert.equal(stats.totalDelivered, 0);
  assert.equal(stats.totalAttempts, 1);
  assert.equal(stats.dailyStats.length, 7);
  assert.ok(
    stats.dailyStats.slice(0, 6).every((d) => d.sent === 0 && d.received === 0),
  );
  assert.ok(stats.recentMessages[0].leadName);
  f.dispatcher.receipt(f.calls[0].args[2], "DELIVERED");
  stats = await (
    await req("/dashboard/stats", "GET", undefined, headers)
  ).json();
  assert.equal(stats.totalDelivered, 1);
  f.provider.send = async () => ({
    success: false,
    definitelyNotSent: true,
    retryable: false,
    error: "Falha sintética",
  });
  const failed = f.create();
  await f.drain(failed.id);
  stats = await (
    await req("/dashboard/stats", "GET", undefined, headers)
  ).json();
  assert.equal(stats.totalSent, 1);
  assert.equal(stats.totalAttempts, 2);
  assert.equal(stats.totalDelivered, 1);
});
