# WappGR

Gestão de contatos e automações para WhatsApp com React, Express e SQLite. Campanhas usam fila persistente com lotes, pausa, retomada, cancelamento, auditoria e relatório por destinatário.

O transporte ativo é exclusivamente **Baileys**, por pareamento do WhatsApp. Lotes e intervalos são controles operacionais, sem promessa de evitar bloqueios. Não são necessárias conta Meta, credenciais oficiais ou templates aprovados. Os arquivos preparatórios da Cloud API foram preservados fora do caminho ativo; essa integração está fora do escopo.

## Instalação

Requer **Node.js 24 ou superior**. Ambiente validado: Node 24.19.0 e npm 11.17.0, Windows. O SQLite vem do próprio Node; não há better-sqlite3 nem compilação nativa desse driver. Apache, PHP, MySQL, Redis e Docker não são necessários.

No PowerShell, dentro da pasta do projeto:

~~~powershell
npm.cmd ci
npm.cmd run migrate
npm.cmd run setup-admin
npm.cmd run dev
~~~

Em outros terminais, use npm no lugar de npm.cmd. O comando setup-admin solicita usuário e senha, sem senha universal. Pare o servidor antes de criar/redefinir administradores, migrar ou restaurar.

Acesse **http://localhost:5173** e faça login. A API usa http://127.0.0.1:3001 e só escuta na máquina local por padrão. Se precisar de configuração própria, crie um .env a partir de [.env.example](.env.example), preservando um .env já existente. Alterar PORT exige ajustar também o proxy em vite.config.js e as origens autorizadas.

Para usar a aplicação compilada:

~~~powershell
npm.cmd run build
npm.cmd run server
~~~

Acesse http://127.0.0.1:3001. O comando preview serve apenas como prévia do frontend.

## Executar sem navegador ou terminal

Campanhas, cron, fluxos e respostas rodam no backend; fechar a página ou expirar o login não interrompe trabalhos autorizados. Para iniciar com o Windows sem login, a entrega inclui uma tarefa de sistema e um supervisor Node com recuperação e logs. **Nesta sessão a tarefa não pôde ser registrada: faltam privilégios de Administrador. A consulta final confirmou que a tarefa não está instalada.**

Em PowerShell **como Administrador**, com o build já gerado:

~~~powershell
npm.cmd run service:install
npm.cmd run service:start
npm.cmd run service:status
~~~

Use `npm.cmd run service:stop` para parar e `npm.cmd run service:remove` para remover a tarefa. A parada fica persistida, inclusive após reiniciar o Windows, até outro `service:start`. Instalar não inicia outra instância imediatamente. Confira o [guia de operação no Windows](docs/OPERACAO_WINDOWS.md) para configuração, logs, recuperação, permissões e diagnóstico. Desligamento, suspensão e falta de internet impedem envios; o instalador não altera energia.

## Exemplo: 1.000 contatos, lotes de 40 e duas horas

1. Em **Gestão de Leads**, aplique os filtros e escolha **Selecionar todos os resultados**. A seleção inclui outras páginas; desmarque exceções ou escolha contatos individualmente.
2. Clique em **Criar campanha com os selecionados** e confira a prévia de elegibilidade do servidor. Apenas contatos com opt-in e identidade válida entram na audiência.
3. Preencha mensagem e título. Use **40 tentativas por lote**, **7.200 segundos entre lotes** e a cadência entre mensagens desejada. Escolha automático ou autorização manual do próximo lote.
4. Salve e acompanhe o progresso. Sem falhas, são **25 lotes e 24 intervalos**, contados após o término de cada lote.
5. **Pausar** preserva o saldo do lote. **Continuar** trabalha na mesma campanha e mantém o horário mínimo. Em modo manual, **Autorizar próximo lote** é uma ação separada.
6. **Cancelar restantes** preserva o histórico e impede novos envios. Uma chamada já em andamento precisa concluir ou ficar com resultado incerto.

Fechar o navegador não interrompe a execução automática. O processo Node deve permanecer funcionando. Reinícios recuperam o banco atual; envios interrompidos ficam incertos e não são repetidos automaticamente.

## Consentimento e restrições

Campanhas e agendamentos exigem opt-in atual, revalidado antes do envio. Não há janela técnica de atendimento de 24 horas imposta a campanhas Baileys.

O WappGR mantém uma **regra interna de atendimento**: respostas humanas exigem entrada do cliente há menos de 24 horas **ou** opt-in; fluxos solicitados exigem entrada recente e ausência de opt-out. Esse prazo usa a última mensagem de cada cliente, não é uma exigência técnica do Baileys e não se renova com reinício ou envio do operador. Descadastro bloqueia promoções e fluxos; atendimento humano recente e confirmação de descadastro seguem suas regras próprias.

Uma **restrição da conta** é um bloqueio operacional global persistente. Reconectar, reiniciar ou completar 24 horas não libera a fila. Em **Conectar WhatsApp**, registre a revisão após o prazo mínimo e continue cada campanha explicitamente. Lotes não contornam restrições.

## Banco e validação

~~~powershell
npm.cmd run backup
npm.cmd run restore -- "C:\caminho\backup.sqlite"
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
~~~

Backup/restauração exigem o servidor parado; quando instalado em segundo plano, use `service:stop` antes e `service:start` depois. A restauração suspende envios e marca trabalhos pendentes do backup como incertos, pois pode haver atividade posterior que não consta naquela cópia. Ela não substitui a retomada normal pelo banco atual. O script pretest gera o build antes da suíte que testa o backend em produção.

Os testes de navegador usam Microsoft Edge headless e um servidor isolado em 127.0.0.1:3187. Nenhum teste usa a conta real de WhatsApp. Se Edge não estiver instalado, instale-o ou ajuste o canal do Playwright para um navegador de teste disponível.

**Validação desta entrega:** 66 testes automatizados e três cenários de navegador aprovados, além de lint, build e instalação limpa em pasta isolada. Incluem nove cenários anteriores de recuperação da fila e novos testes de backend autônomo, supervisor, parada durante envio, rotação, parada sem logout e reconexão sem operador. Registro como SYSTEM e reboot real não foram validados por falta de privilégios. Todos os testes usam transporte sintético.

Veja o [relatório de implementação, testes e limitações](docs/IMPLEMENTACAO_E_VALIDACAO.md), as [evidências do banco](docs/validacao/banco.json) e o [relatório histórico anterior às alterações](docs/RELATORIO_COMPLETO_WAPPGR.md).
