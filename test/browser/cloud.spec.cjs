const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page, request }) => {
  await request.post("/__test/reset");
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("operador-teste");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("senha-isolada-de-testes");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
});
async function capture(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const dialogForm = page.getByRole("dialog").locator("form");
  if (await dialogForm.count())
    await dialogForm.evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "test-results/cloud-" + name + ".png",
    fullPage: true,
  });
}
test("categorias: sem seleção inicial, validação visível, filtro de modelos e persistência na edição", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Disparos em Massa", exact: true })
    .click();
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.locator("input[type=radio]:checked")).toHaveCount(0);
  await page
    .getByLabel("Título", { exact: true })
    .fill("Categorias persistidas");
  await page
    .getByLabel("Mensagem (texto)", { exact: true })
    .fill("Mensagem livre");
  await page
    .getByRole("button", { name: "Salvar campanha", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Selecione a Categoria" }).last(),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Utilidade", exact: true }).check();
  await expect(
    page.getByLabel("Mensagem (texto)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Modelo aprovado")).toHaveValue("");
  await expect(
    page.getByLabel("Modelo aprovado").locator("option"),
  ).toHaveCount(1);
  await page.getByRole("radio", { name: "Marketing", exact: true }).check();
  await expect(page.locator("input[type=radio]:checked")).toHaveCount(1);
  await page.getByLabel("Modelo aprovado").selectOption("synthetic-marketing");
  await page.getByLabel("Origem do parâmetro body::1").selectOption("name");
  await expect(
    page.getByText("Estimativa indisponível", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Início", { exact: true }).selectOption("DRAFT");
  await capture(page, "template");
  await page
    .getByRole("button", { name: "Salvar campanha", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Iniciar", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Disparos em Massa", exact: true })
    .click();
  await page.getByRole("button", { name: /Categorias persistidas/ }).click();
  await page
    .getByRole("button", {
      name: "Editar / revisar categoria e conteúdo",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("radio", { name: "Marketing", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Modelo aprovado")).toHaveValue(
    "synthetic-marketing",
  );
  await expect(page.getByLabel("Origem do parâmetro body::1")).toHaveValue(
    "name",
  );
  await page.getByRole("radio", { name: "Serviço", exact: true }).check();
  await page
    .getByLabel("Mensagem (texto)", { exact: true })
    .fill("Novo atendimento");
  const updated = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      r.url().includes("/api/v1/campaigns/"),
  );
  await page
    .getByRole("button", { name: "Salvar campanha", exact: true })
    .click();
  expect((await updated).ok()).toBeTruthy();
  const saved = await (await page.request.get("/api/v1/campaigns")).json();
  expect(saved[0].message_category).toBe("SERVICE");
  expect(saved[0].messageConfig.template).toBeUndefined();
  await page.reload();
  await page
    .getByRole("button", { name: "Disparos em Massa", exact: true })
    .click();
  await page.getByRole("button", { name: /Categorias persistidas/ }).click();
  await page
    .getByRole("button", {
      name: "Editar / revisar categoria e conteúdo",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("radio", { name: "Serviço", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Mensagem (texto)", { exact: true }),
  ).toHaveValue("Novo atendimento");
});
test("fluxos: herança, substituição explícita, modelo compatível e persistência após recarregar", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Fluxos & Funis", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Criar Novo Fluxo", exact: true })
    .click();
  await expect(page.locator("input[type=radio]:checked")).toHaveCount(0);
  await page
    .getByPlaceholder("Ex: Funil de Apresentação de Produtos", { exact: true })
    .fill("Fluxo com herança");
  await page
    .getByRole("button", { name: "Salvar Funil Completo", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Selecione a Categoria" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Serviço", exact: true }).check();
  await expect(
    page.getByText(/Categoria efetiva: Serviço · Herdada do fluxo/),
  ).toHaveCount(3);
  await page
    .getByRole("checkbox", {
      name: "Substituir categoria nesta etapa",
      exact: true,
    })
    .first()
    .check();
  await page
    .getByRole("button", { name: "Salvar Funil Completo", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "substituição explícita" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Marketing", exact: true })
    .last()
    .check();
  await page.getByLabel("Modelo aprovado").selectOption("synthetic-marketing");
  await page.getByLabel("Origem do parâmetro body::1").selectOption("name");
  await page
    .getByRole("button", {
      name: "Prévia de elegibilidade e custos do fluxo",
      exact: true,
    })
    .click();
  await expect(page.getByText(/Não há total exato por fluxo/i)).toBeVisible();
  await capture(page, "flow-editor");
  await page
    .getByRole("button", { name: "Salvar Funil Completo", exact: true })
    .click();
  await expect(
    page.getByText("Fluxo com herança", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Fluxos & Funis", exact: true })
    .click();
  const rows = await (await page.request.get("/api/v1/flows")).json();
  expect(rows[0].messageCategory).toBe("SERVICE");
  expect(rows[0].steps[0].messageCategory).toBe("MARKETING");
  expect(rows[0].steps[1].messageCategory).toBeNull();
  await page
    .getByTitle(/Editar/)
    .first()
    .click();
  await expect(
    page.getByRole("radio", { name: "Serviço", exact: true }).first(),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Marketing", exact: true }).last(),
  ).toBeChecked();
  await expect(page.getByLabel("Modelo aprovado")).toHaveValue(
    "synthetic-marketing",
  );
});
test("agendamentos: categoria obrigatória, rascunho editável e persistência após recarregar", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Agendador \(Cron\)/ }).click();
  await expect(page.locator("input[type=radio]:checked")).toHaveCount(0);
  await page
    .getByLabel("Título da regra", { exact: true })
    .fill("Regra revisada");
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-10-20");
  await page
    .getByLabel("Mensagem da regra", { exact: true })
    .fill("Atendimento solicitado");
  await page.getByRole("button", { name: "Criar regra", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Selecione a Categoria" }).last(),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Ativar regra ao salvar/ })
    .uncheck();
  await page.getByRole("button", { name: "Criar regra", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Regra revisada · Inativa",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Editar / revisar", exact: true })
    .click();
  await page.getByRole("radio", { name: "Serviço", exact: true }).check();
  await page.getByRole("checkbox", { name: /Ativar regra ao salvar/ }).check();
  await capture(page, "schedule");
  await page
    .getByRole("button", { name: "Salvar revisão", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Regra revisada · Ativa", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Agendador \(Cron\)/ }).click();
  await page
    .getByRole("button", { name: "Editar / revisar", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Serviço", exact: true }),
  ).toBeChecked();
});
test("revisão de legado e configuração administrativa não revelam segredos", async ({
  page,
  request,
}) => {
  const { id } = await (await request.post("/__test/legacy")).json();
  await page
    .getByRole("button", { name: "Disparos em Massa", exact: true })
    .click();
  await page.getByRole("button", { name: /Teste isolado/ }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Revise categoria/ })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Editar / revisar categoria e conteúdo",
      exact: true,
    })
    .click();
  await expect(page.locator("input[type=radio]:checked")).toHaveCount(0);
  await page.getByRole("radio", { name: "Serviço", exact: true }).check();
  await page.getByRole("checkbox", { name: /Revisei a categoria/ }).check();
  await page
    .getByRole("button", { name: "Salvar campanha", exact: true })
    .click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const c = await (await page.request.get("/api/v1/campaigns/" + id)).json();
  expect(c.review_required).toBe(0);
  expect(c.manual_paused).toBe(0);
  expect(c.message_category).toBe("SERVICE");
  await page.getByRole("button", { name: /Conectar WhatsApp/ }).click();
  await page
    .getByRole("button", { name: "Testar permissões sem enviar", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /nenhum envio/ }),
  ).toBeVisible();
  const config = await (await page.request.get("/api/v1/cloud/config")).text();
  expect(config).not.toContain("synthetic-token");
  expect(config).not.toContain("synthetic-secret");
  expect(config).not.toContain("synthetic-verify");
  await expect(page.getByRole("img", { name: /QR Code/ })).toHaveCount(0);
  await capture(page, "configuration");
});
