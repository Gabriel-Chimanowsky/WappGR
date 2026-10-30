# Checkpoint da migração Cloud API — 29/10/2026

A implementação local foi concluída preservando as alterações anteriores. Não publicar nem iniciar envios reais com base apenas nos testes simulados.

Conferência da retomada: o navegador havia concluído com sucesso antes da interrupção. Os 38 arquivos de código registrados e todas as evidências continuam com os mesmos hashes. Lint, build e testes correspondem à versão final; nenhuma reexecução ou alteração funcional foi necessária. Entrega local encerrada.

- Backup `server/backups/manual-1793259986143.sqlite` íntegro, esquema v2. Identidade e SHA-256 em `docs/validacao/cloud-backup.json`. O banco operacional local permanece v2.
- Cloud API integrada a backend, fila, chat, cron e fluxos. Categorias/modelos/janela, revisão de legado, custos, configurações e webhooks implementados. Backend padrão não inicializa Baileys.
- `npm.cmd test`: 80/80 aprovados, incluindo 14 cenários Cloud API, migração isolada, fila/autonomia/supervisor. Última repetição após corrigir cancelamento de jobs WAITING_WINDOW/SUSPENDED: código 0.
- `npm.cmd run lint`: código 0. Build executado pelo pretest: aprovado, com avisos de configuração Vite e tamanho do bundle.
- Navegador: 8/8 aprovados após o último ajuste, código 0 em 54,7 segundos. Último comando de testes: `npm.cmd run test:browser *> docs/validacao/cloud-browser.txt` (sessão 40152 encerrada). Resumo final e hashes em `docs/validacao/cloud-verificacoes.json`.
- Telas de campanha, fluxo, agendamento e configuração inspecionadas visualmente. Capturas em `docs/validacao/cloud-*.png`.
- Guia Meta/HTTPS/Contabo: `docs/CLOUD_API.md`. Matriz de testes e limitações: `docs/VALIDACAO_CLOUD_API.md`. README e operação Windows atualizados.

Nenhuma falha conhecida do produto permanece aberta na validação local. Suítes, lint, build, links da documentação e inspeção visual concluídos. Última verificação adicional: `git diff --check` e sintaxe do exemplo PM2 aprovados. Próxima ação concreta, fora desta etapa: configurar um ambiente oficial de homologação Meta conforme o guia, sem ativar registros antigos antes da revisão. Preservar as alterações e evidências; não reiniciar a investigação.

Pendências externas: domínio/TLS, credenciais e permissões Meta, WABA/Phone Number ID, versão Graph confirmada no painel, subscrição/webhooks opcionais, modelos e tarifas vigentes, homologação oficial de mídia/recibos/correlação. O portal técnico direto retornou HTTP 429; fontes primárias acessíveis e pontos não confirmados estão no guia. Nginx/PM2 na VPS, tarefa SYSTEM e reboot real não foram executados. Nenhum envio real, migração de número ou publicação na Contabo foi realizado.
