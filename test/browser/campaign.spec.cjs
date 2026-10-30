const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});
test("interface: login, criação, pausa no 17, recarga, retomada de saldo e cancelamento", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
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
    .fill("Campanha visual isolada");
  await page.getByRole("radio", { name: "Servi\u00e7o", exact: true }).check();
  await page.getByLabel("Mensagem (texto)", { exact: true }).fill("Olá {nome}");
  await page.getByLabel(/^Entre mensagens/).fill("2");
  await expect(page.getByText("1000 elegíveis", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/campanha-formulario.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Salvar campanha", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pausar", exact: true }),
  ).toBeVisible();
  await request.post("/__test/step", { data: { n: 17 } });
  await page
    .getByRole("button", { name: "Atualizar campanha", exact: true })
    .click();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continuar", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/17 \/ 40 tentativas/)).toBeVisible();
  await page.screenshot({
    path: "test-results/campanha-pausada17.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Disparos em Massa", exact: true })
    .click();
  await page.getByRole("button", { name: /Campanha visual isolada/ }).click();
  await expect(
    page.getByRole("button", { name: "Continuar", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await request.post("/__test/step", { data: { n: 23 } });
  await page
    .getByRole("button", { name: "Atualizar campanha", exact: true })
    .click();
  await expect(page.getByText(/40 \/ 40 tentativas/)).toBeVisible();
  await page.screenshot({
    path: "test-results/campanha-intervalo.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await request.post("/__test/step", { data: { n: 1 } });
  await page
    .getByRole("button", { name: "Atualizar campanha", exact: true })
    .click();
  await expect(page.getByText(/total de tentativas: 40/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Cancelar restantes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancelar restantes", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("interface: seleção entre páginas, exclusões, campanhas manuais e relatórios", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("operador-teste");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("senha-isolada-de-testes");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("button", { name: /Gestão de Leads/ })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: "Selecionar todos os 1000 resultados",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.getByText("1000 registros · página 2 de 20")).toBeVisible();
  await page.getByRole("checkbox").first().uncheck();
  await page
    .getByRole("button", {
      name: "Criar campanha com 999 selecionados",
      exact: true,
    })
    .click();
  await expect(page.getByText("999 elegíveis", { exact: true })).toBeVisible();
  await page
    .getByLabel("Título", { exact: true })
    .fill("Seleção entre páginas");
  await page.getByRole("radio", { name: "Servi\u00e7o", exact: true }).check();
  await page
    .getByLabel("Mensagem (texto)", { exact: true })
    .fill("Teste {nome}");
  await page.getByLabel("Modo", { exact: true }).selectOption("MANUAL");
  await page.getByLabel("Início", { exact: true }).selectOption("DRAFT");
  await page
    .getByRole("button", { name: "Salvar campanha", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Iniciar", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pausar", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exportar relatório", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("campanha.csv");
  await page.screenshot({
    path: "test-results/selecao-entre-paginas.png",
    fullPage: true,
  });
});
test("interface: importação, fluxo, chat, agendamento, CRM e revisão da restrição", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("operador-teste");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("senha-isolada-de-testes");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("button", { name: /Gestão de Leads/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Importar CSV/TXT", exact: true })
    .click();
  await page
    .getByLabel("Dados para importar", { exact: true })
    .fill(
      "Nome|Telefone|Status de Consentimento\nCSV sintético|11988887777|PENDING",
    );
  await expect(
    page.getByText("1 contatos reconhecidos", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Importar 1 contatos", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1 novos");
  await page
    .getByRole("button", { name: "Fluxos & Funis", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Criar Novo Fluxo", exact: true })
    .click();
  await page
    .getByPlaceholder("Ex: Funil de Apresentação de Produtos", { exact: true })
    .fill("Fluxo visual validado");
  await page
    .getByRole("radio", { name: "Servi\u00e7o", exact: true })
    .first()
    .check();
  await page.getByPlaceholder("1", { exact: true }).first().fill("SAIR");
  await page
    .getByRole("button", { name: "Salvar Funil Completo", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Palavra reservada");
  await expect(
    page.getByPlaceholder("Ex: Funil de Apresentação de Produtos", {
      exact: true,
    }),
  ).toHaveValue("Fluxo visual validado");
  await page.getByPlaceholder("1", { exact: true }).first().fill("1");
  await page
    .getByRole("button", { name: "Salvar Funil Completo", exact: true })
    .click();
  await expect(
    page.getByText("Fluxo visual validado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Palavra reservada" }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/fluxos.png", fullPage: true });
  await page
    .getByRole("button", { name: "Chat em Tempo Real", exact: true })
    .click();
  await expect(page.getByText(/Atendimento de Servi/)).toContainText(
    "24 horas",
  );
  await page
    .getByLabel("Buscar conversa", { exact: true })
    .fill("Pessoa sintética 999");
  await page.getByRole("button", { name: /Pessoa sintética 999/ }).click();
  await page
    .getByLabel("Mensagem de atendimento", { exact: true })
    .fill("Resposta humana sintética");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(
    page.getByText("Resposta humana sintética", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/chat-paginado.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Agendador \(Cron\)/ }).click();
  await page
    .getByLabel("Título da regra", { exact: true })
    .fill("Regra visual");
  await page.getByLabel("Recorrência", { exact: true }).selectOption("ONCE");
  await page.getByLabel("Data inicial", { exact: true }).fill("2026-10-20");
  await page
    .getByLabel("Mensagem da regra", { exact: true })
    .fill("Agendamento sintético");
  await page.getByRole("radio", { name: "Servi\u00e7o", exact: true }).check();
  await page.getByRole("button", { name: "Criar regra", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Regra visual · Ativa", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Desativar próximas ocorrências",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Regra visual · Inativa", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Integração CRM", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Validar simulação", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Nenhum contato criado" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Conectar WhatsApp/ }).click();
  await expect(
    page.getByRole("heading", { name: /Cloud API oficial/ }),
  ).toBeVisible();
  await page
    .getByLabel("Motivo da suspensão ou registro da revisão", { exact: true })
    .fill("Restrição sintética de 24 horas");
  await page
    .getByRole("button", { name: "Suspender todos os envios", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Registrar revisão e liberar a conta",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/conta-restrita.png",
    fullPage: true,
  });
  await request.post("/__test/advance", { data: { ms: 86400001 } });
  // The 12h administrative session also expires during this 24h clock advance.
  await page.reload();
  await page.getByLabel("Usuário", { exact: true }).fill("operador-teste");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("senha-isolada-de-testes");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: /Conectar WhatsApp/ }).click();
  await page.getByRole("checkbox", { name: /Revisei a situação/ }).check();
  await page
    .getByLabel("Motivo da suspensão ou registro da revisão", { exact: true })
    .fill("Revisão sintética concluída");
  await page
    .getByRole("button", {
      name: "Registrar revisão e liberar a conta",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Suspender todos os envios",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
