const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("interface sem randomUUID: criação e repetição não duplicam a campanha", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
  });
  const createKeys = [],
    actionKeys = [],
    uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  await page.route("**/api/v1/campaigns/send", async (route) => {
    createKeys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    if (createKeys.length === 1) {
      // The server committed the campaign, but the client did not get its result.
      await route.fulfill({
        status: 503,
        json: { error: "Falha de resposta simulada" },
      });
    } else await route.fulfill({ response });
  });
  await page.route("**/api/v1/campaigns/*/start", async (route) => {
    actionKeys.push(route.request().headers()["idempotency-key"]);
    await route.continue();
  });

  await page.goto("/");
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  await page.getByLabel("Usuário", { exact: true }).fill("operador-teste");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("senha-isolada-de-testes");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("button", { name: "Disparos em Massa", exact: true })
    .click();
  await page
    .getByLabel("Título", { exact: true })
    .fill("Campanha sem randomUUID");
  await page.getByRole("radio", { name: "Servi\u00e7o", exact: true }).check();
  await page
    .getByLabel("Mensagem (texto)", { exact: true })
    .fill("Teste sintético");
  await page.getByLabel("Início", { exact: true }).selectOption("DRAFT");
  const save = page.getByRole("button", {
    name: "Salvar campanha",
    exact: true,
  });
  await save.click();
  await expect(page.getByRole("alert").first()).toHaveText(
    "Falha de resposta simulada",
  );
  await save.click();
  await expect(
    page.getByRole("button", { name: "Iniciar", exact: true }),
  ).toBeVisible();
  expect(createKeys).toHaveLength(2);
  expect(createKeys[0]).toMatch(uuidV4);
  expect(createKeys[1]).toBe(createKeys[0]);
  const campaigns = await (await page.request.get("/api/v1/campaigns")).json();
  expect(
    campaigns.filter((c) => c.title === "Campanha sem randomUUID"),
  ).toHaveLength(1);

  await page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pausar", exact: true }),
  ).toBeVisible();
  expect(actionKeys).toHaveLength(1);
  expect(actionKeys[0]).toMatch(uuidV4);
  expect(actionKeys[0]).not.toBe(createKeys[0]);
});
