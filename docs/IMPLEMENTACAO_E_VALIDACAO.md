# Implementação e validação do WappGR

**Data:** 16 de outubro de 2026. Este documento descreve as alterações posteriores ao relatório original de 15/10. Os testes usam contatos sintéticos e transportes simulados; não foram feitos disparos reais nem alterações no pareamento existente.

## 1. Resultado integrado

O caminho ativo continua React → Express → SQLite → Baileys. O driver SQLite foi substituído integralmente por node:sqlite do Node 24 através de server/sqlite.js. Não há dependência ativa de better-sqlite3 nem infraestrutura adicional de filas.

**Escopo confirmado:** uso exclusivo do Baileys. A Cloud API está fora do escopo e não é uma pendência desta entrega. O arquivo preparatório server/cloud-api.js e seus testes anteriores foram preservados, sem importação no servidor, seleção de transporte, credenciais exigidas ou configuração nas telas. A revisão manteve o trabalho existente e corrigiu a reserva de cadência antes de chamadas de envio e na recuperação de interrupções.

**Operação em segundo plano:** foram acrescentados supervisor, logs rotativos, saúde, encerramento controlado e scripts de tarefa Windows. A configuração está preparada; o registro da tarefa de produção não foi permitido nesta sessão sem privilégios de Administrador. Consulte o [guia com comandos e estado verificado](OPERACAO_WINDOWS.md).

~~~mermaid
flowchart LR
    UI["Interface com login"] --> API["Express: sessão, CSRF e validação"]
    API --> DB[("SQLite: campanhas, destinatários, lotes e tentativas")]
    S["Agendamentos"] --> DB
    F["Entradas e sessões de fluxo"] --> DB
    DB --> D["Despachante único: prioridade e cadência"]
    D --> B["Adaptador Baileys ativo"]
    B --> D
    B --> F
~~~

| Parte | Implementação principal |
|---|---|
| Inicialização, exclusão de concorrência e recuperação | server/index.js, server/backend.js, server/instance-lock.js |
| Execução autônoma, supervisor, logs e tarefa Windows | server/runtime.js, server/supervisor.js, server/operations.js, server/config.js, server/service-control.js, scripts/windows.ps1 |
| API e autenticação administrativa | server/app.js, server/auth.js, server/setup-admin.js |
| Esquema, migrações e backup | server/db.js, server/sqlite.js, server/migrations.js, server/migrate.js, server/backup.js |
| Audiência congelada, idempotência e controles | server/campaigns.js |
| Transporte compartilhado, tentativas e recibos | server/dispatcher.js, server/baileys.js |
| Consentimento, contatos e importação | server/policy.js, server/leads.js, shared/csv.mjs |
| Agendamentos e continuidade dos fluxos | server/scheduler.js, server/time.js, server/flows.js |
| Telas e acesso | src/App.jsx, src/components/*, src/lib/api.js |

## 2. Campanhas em lotes

A seleção aceita IDs individuais ou filtros de categoria, status e busca, com exclusões individuais. A tela consulta páginas no servidor, e selecionar todos os resultados consulta a base inteira, até 100.000 contatos por operação. O teste inclui 10.005 contatos e seleção além da página atual.

A prévia informa selecionados, elegíveis e motivos de exclusão. Ao criar, o servidor salva uma lista ordenada e deduplicada, destino, nome, categoria, mensagem personalizada e configurações. Alterar filtros, formulário ou categoria depois não modifica essa lista. Cada tentativa revalida contato existente, telefone/JID e consentimento. Exclusão, mudança de identidade e opt-out impedem envios subsequentes daquele destinatário.

| Configuração | Padrão | Faixa validada |
|---|---:|---|
| Tentativas por lote | 40 | 1–200 |
| Intervalo entre lotes | 7.200 s | 60–604.800 s |
| Intervalo entre mensagens | 10 s | 1–300 s; mínimo global efetivo de 2 s |
| Tentativas automáticas por destinatário | 3 | 1–5 |
| Modo | Automático | Automático ou autorização manual |
| Início | Imediato | Imediato, agendado ou rascunho |
| Fuso | America/Sao_Paulo | Identificador IANA válido |

Cada chamada ao adaptador consome uma vaga do lote, inclusive retry. Por isso falhas podem reduzir a quantidade de novos destinatários atendidos naquele ciclo. Falhas transitórias comprovadamente sem envio usam espera progressiva de 30 s, 60 s, 120 s etc., limitada a uma hora e ao limite de tentativas. Retry seletivo acrescenta uma tentativa explícita, respeita o intervalo de lote e não ultrapassa cinco tentativas totais por destinatário.

No adaptador Baileys, desconexão detectada antes de chamar o SDK é uma falha comprovadamente sem envio. Exceções durante sendMessage são tratadas como resultado incerto, pois não provam ausência de entrega; não entram em retry automático. Falha ao carregar mídia não dispara um envio alternativo oculto.

Sem falhas: 1.000 contatos geram 25 lotes de 40, 24 intervalos e nenhuma espera final de duas horas. A espera começa quando o lote termina. Se o servidor voltar depois do horário mínimo, executa o próximo lote e calcula uma nova espera após ele, sem compensar vários lotes de uma vez.

Pausar durante uma chamada mostra PAUSE_REQUESTED até o retorno. Pausar após a tentativa 17 deixa 23 vagas no lote de 40. Retomar mantém esse saldo e os resultados anteriores. Pausar durante o intervalo preserva next_run_at. No modo manual, retomar e autorizar o próximo lote são comandos separados; autorizar não antecipa o horário mínimo.

Cancelamento marca o restante como CANCELLED e mantém tentativas, mensagens e eventos. Não é exclusão da campanha. Criação e controles exigem Idempotency-Key, associada ao conteúdo da requisição: repetir a mesma chave e corpo reproduz a resposta; reutilizar a chave com outro corpo retorna 409.

### API principal da fila

Todos os caminhos abaixo têm prefixo /api/v1 e exigem sessão administrativa. Mutações exigem X-CSRF-Token; criação e comandos exigem Idempotency-Key. A chave deve ser mantida ao repetir a mesma requisição após timeout. Uma alteração de conteúdo exige outra chave.

| Método e caminho | Resultado |
|---|---|
| POST /campaigns/preview | Prévia de selection, elegibilidade e exclusões |
| POST /campaigns ou /campaigns/send | Cria campanha e audiência congelada; não executa loop antigo |
| GET /campaigns e /campaigns/:id | Campanhas recentes e progresso derivado |
| POST /campaigns/:id/start | Inicia rascunho |
| POST /campaigns/:id/pause | Persiste pausa ou pedido de pausa |
| POST /campaigns/:id/resume | Retoma mantendo saldo e horário mínimo |
| POST /campaigns/:id/authorize-next | Autoriza próximo lote manual sem antecipar horário |
| POST /campaigns/:id/cancel | Cancela o restante, mantendo histórico |
| POST /campaigns/:id/retry | Reprocessa recipientIds elegíveis, limitado a 1.000 IDs por comando |
| GET /campaigns/:id/recipients?page=1&limit=50&status=FAILED | Relatório paginado, até 500 por página |
| GET /campaigns/:id/events?after=0 | Até 100 eventos recentes |
| GET /campaigns/:id/export | CSV do snapshot completo |

selection aceita {type:"ids",ids:[...],excludedIds:[...]} ou {type:"filters",filters:{categoryId,status,search},excludedIds:[...]}. Criação recebe title, message, batchSize, batchIntervalSeconds, pacingSeconds, maxAttempts, mode, startMode e timezone. Início agendado aceita startLocal no formato AAAA-MM-DDTHH:mm no fuso escolhido ou startAt UTC terminado em Z. Transições incompatíveis retornam 409; validações retornam 400; sessão ausente retorna 401.

## 3. Concorrência, reinício e resultado incerto

Uma instalação permite **um processo ativo em um host**, impondo lock por PID/host antes de abrir banco ou transporte. Não há suporte anunciado a múltiplos workers, múltiplas máquinas ou banco em compartilhamento de rede.

O diretório de credenciais também possui lock, impedindo dois backends de assumirem a mesma sessão com bancos diferentes. Os loops são iniciados pelo backend; nenhuma automação pertence ao polling da tela ou à sessão do operador. Parada pelo supervisor usa IPC e fecha o socket sem logout; a intenção administrativa de parada permanece até comando start.

Aquisições e resultados usam transações curtas, proprietário e token de processamento. A rede é chamada fora da transação. Posição, tentativa, lote, saldo e horários vêm do banco.

A cadência compartilhada é reservada no SQLite **antes** da chamada de rede e novamente após a conclusão. Ao recuperar uma chamada interrompida, o despachante aguarda um intervalo completo a partir do reinício, conforme a cadência da campanha ou o mínimo global dos trabalhos individuais. Isso impede que uma queda elimine a espera; o registro incerto não é reenviado. Pausas preservam também essa espera.

| Situação | Comportamento |
|---|---|
| Navegador fechado | O servidor continua a execução automática |
| Servidor desligado | Não há envios; o banco é recuperado no próximo início |
| Pausa manual | Continua pausada após reinício e reconexão |
| Desconexão comum | Novas tentativas aguardam conexão, sem consumir a fila inteira em falhas |
| Chamada interrompida | Fica UNCERTAIN, sem retry automático |
| Provedor aceitou, processo caiu antes do commit | Permanece incerta até possível recibo identificado |
| Recibo tardio de entrega/leitura | Reconcilia pelo identificador persistido, sem reiniciar campanha |
| Restrição de conta | Bloqueio persistente até revisão operacional e continuação explícita |

A integração não promete envio exatamente uma vez. Em resultado incerto, o destinatário pode ter recebido a mensagem. Repetição automática seria arriscada e é bloqueada. A reconciliação depende de evidência disponibilizada pelo provedor; não existe garantia de que o Baileys reenviará todos os recibos perdidos.

## 4. Consentimento, regra interna de atendimento e restrição de conta

Comandos textuais de descadastro precedem sessões e gatilhos. Opções numéricas de menu não são comandos globais de consentimento. Comandos textuais existentes são preservados na migração; números são removidos da configuração global. Uma entrada pendente do próprio contato é processada antes de iniciar seu envio, mesmo atrás de outras entradas.

Cadastro começa pendente. Importação e webhook preservam opt-out existente. Novos opt-ins importados exigem declaração de evidência e motivo; reimportação não concede opt-in a contatos existentes. A alteração manual registra origem, data, motivo e operador; reautorizar uma recusa exige reconfirmação explícita. Trocar telefone invalida a janela e a autorização anteriores.

A política abaixo é uma escolha interna do WappGR, aplicada no servidor antes do Baileys. **Não é uma exigência técnica do Baileys nem uma transposição da janela da Cloud API.** Campanhas e agendamentos não exigem entrada nas últimas 24 horas: opt-in atual autoriza sua elegibilidade mesmo sem entrada anterior ou com conversa mais antiga.

| Tipo | Regra aplicada no servidor |
|---|---|
| Campanha promocional e agendamento | OPT_IN atual e identidade congelada compatível |
| Fluxo solicitado | Última entrada do cliente há menos de 24 h e ausência de OPT_OUT |
| Confirmação de descadastro | Status atual OPT_OUT |
| Resposta humana | Última entrada há menos de 24 h **ou** OPT_IN |
| Resposta de consentimento | Última entrada há menos de 24 h |

A janela é individual por destinatário. O horário vem da mensagem do provedor; na ausência dele, usa-se o instante de recebimento persistido. Processar uma entrada atrasada ou reiniciar não renova esse horário. Mensagens futuras e janelas de 24 h já completas não são consideradas recentes. Uma autorização antiga recebida com atraso não desfaz um opt-out mais recente.

Opt-out interrompe promoções e fluxos pendentes. Há duas exceções explícitas de atendimento: confirmação do descadastro e resposta humana a uma entrada recente. Elas não restauram opt-in nem autorizam campanha; respostas humanas passam pela mesma cadência e pelo bloqueio global de conta. Uma chamada já entregue ao SDK não pode ser desfeita.

**Restrição temporária da conta:** é um bloqueio global separado. Pode ser registrada pelo operador com prazo mínimo, inclusive 24 h, ou por sinal explícito do transporte. O término do prazo e a reconexão não liberam os envios. A revisão é auditada; campanhas existentes, inclusive as criadas durante a restrição, permanecem pausadas até continuação explícita. A detecção automática de restrições pelo Baileys é limitada; o operador pode precisar registrar a suspensão manualmente.

Não há exigência de conta Meta, credenciais oficiais ou templates aprovados para instalar ou operar este caminho Baileys. O adaptador oficial inativo não participa dessa política e não será concluído como parte deste escopo.

## 5. Chat, agendamentos e fluxos

Chat, campanhas, agendamentos e fluxos passam pelo mesmo Dispatcher. Há uma chamada de envio por vez e horário global persistido para o próximo envio. Respostas têm prioridade, com no máximo três trabalhos interativos consecutivos quando há campanha pronta, para evitar bloqueio indefinido de um dos lados.

O chat consulta o histórico por contato e por página; os rascunhos e estados não se misturam ao trocar conversa. Mensagens entram primeiro na fila e mostram estados reais. Aceitação pelo SDK não é exibida como entrega ou leitura.

Agendamentos usam fuso explícito e datas UTC, calculam próxima ocorrência, deduplicam por regra/horário e criam campanhas rastreáveis. ONCE desativa após a ocorrência. Alternância usa dias do calendário, sem depender de 48 h desde o fim anterior. Há recuperação de no máximo uma ocorrência vencida, e uma execução ainda aberta impede sobreposição. Desativar/excluir regra não cancela campanhas já criadas. Regras ONCE legadas são desativadas para revisão, pois não havia execução única confiável.

Fluxos mantêm sessões, etapas aguardadas, atrasos e expiração no SQLite. Destinos e ciclos automáticos são validados; retornos interativos são permitidos, com limite de 20 passos por encadeamento automático e expiração de 24 h. Fim de fluxo com destino vazio encerra a sessão. Exclusão do contato remove sua sessão. Desativação/edição cancela trabalhos pendentes; a política é revalidada depois de carregar mídia e antes da chamada de envio. Atraso de etapa e cadência global são controles distintos, sem reaplicar o mesmo atraso no encadeamento.

Categorias usam IDs estáveis. A personalização carrega a categoria real. Opções são texto numerado, não botões nativos. Mídias exigem HTTPS e host autorizado em WAPPGR_MEDIA_HOSTS, sem redirecionamentos e com limite de 20 MiB. Não há fallback oculto para outro envio depois de falha incerta. Texto complementar de áudio passa por outro trabalho persistente e pela mesma cadência.

## 6. Importação, indicadores e acesso

O parser de CSV é linear, suporta vírgula, ponto e vírgula, tabulação e barra vertical, aspas duplicadas e quebras de linha dentro de campos. “Envios realizados” não é tratado como data do último envio. Exportação/reimportação preserva OPT_OUT. Telefones nacionais de 10/11 dígitos recebem DDI 55 inclusive quando o DDD é 55; números internacionais devem ser informados com +. LID é identidade separada, sem fingir ser telefone elegível para campanha.

A interface oferece CSV/TXT e texto colado. Para Excel, exporte CSV UTF-8 ou cole as células: **XLS/XLSX direto não é suportado nesta entrega**. Contagens importadas não são adotadas como prova de envio; a coluna de contagem é reconhecida para não ser confundida com data.

O dashboard usa registros aceitos pelo provedor, recibos efetivos e tentativas. Percentuais fixos e promessas “anti-ban” foram removidos. O gráfico cobre sete dias UTC e preenche zeros. Contagens antigas de leads ficam separadas como snapshot legado; o contador atual é reconciliado com registros comprovados. Mensagens históricas ambíguas ficam LEGACY_UNKNOWN, e campanhas sem destinatários individuais ficam LEGACY sem retomada.

A autenticação é aplicada no Express antes de todas as rotas administrativas, inclusive dados, QR Code, configuração e envio. Sessões duram 12 h, usam cookie HttpOnly/SameSite=Strict, hash de token no banco e token CSRF nas mutações. CORS tem origens explícitas, há limites de requisição e JSON de até 10 MiB. O webhook exige x-api-key e recusa configuração ausente. A leitura de CRM não revela a chave; a rotação exibe a nova chave somente na resposta da operação.

Simuladores de opt-in e CRM não gravam dados nem enviam. A execução manual de um fluxo é identificada como real e passa pela política do servidor. Reparos de categoria exigem prévia e IDs explícitos; não há limpeza heurística automática nem exclusão por GET. Banco, backups, autenticação e .env estão ignorados no Git. O .htaccess impede servir o código por Apache quando suas regras de acesso estão habilitadas; a aplicação deve ser acessada pelas portas Node/Vite.

## 7. Migrações e recuperação

O procedimento de instalação está no [README](../README.md). Também é possível executar somente as migrações:

~~~powershell
npm.cmd run migrate
~~~

O comando aplica lock, cria backup consistente com VACUUM INTO antes de migrar um banco existente e não inicializa WhatsApp. Essa técnica inclui dados já confirmados no WAL. Versões aplicadas constam em schema_migrations:

- **v1:** fila, destinatários, lotes, tentativas, eventos, idempotência, trabalhos compartilhados, inbox, ocorrências, auditoria, autenticação e bloqueio de conta; preservação do legado.
- **v2:** preserva a contagem anterior em legacy_messages_sent_count e reconcilia o contador atual somente com mensagens aceitas/entregues/lidas. O caminho v1 → v2 foi testado sem reclassificar mensagens novas como legado.

Na cópia local, a migração preservou **0 leads, 6 categorias, 2 campanhas e 17 mensagens**. As campanhas antigas ficaram LEGACY; 14 saídas ficaram LEGACY_UNKNOWN e três entradas RECEIVED. Conteúdo das campanhas/mensagens e configuração CRM foram comparados antes/depois. A integridade retornou ok, sem violações de chaves estrangeiras. Veja [banco.json](validacao/banco.json) e [migracao.txt](validacao/migracao.txt).

Backup e restauração operacionais, com o servidor parado:

~~~powershell
npm.cmd run backup
npm.cmd run restore -- "C:\caminho\backup.sqlite"
~~~

A restauração valida a cópia, guarda um backup do banco substituído e aplica migrações pendentes. Como o arquivo restaurado pode não conter envios posteriores ao backup, suspende a conta e marca trabalhos inacabados como incertos. Eles não recebem retry automático. Revisar a conta não autoriza repetir registros incertos; reconcilie-os antes de preparar outra audiência. Para pausar/continuar normalmente, use a campanha e o banco atual.

Credenciais Baileys ficam separadas do SQLite e não são alteradas por backup/migração/restauração. O banco contém sessões administrativas e configurações; trate seus backups como dados privados.

## 8. Evidências verificáveis

**Resultado atual:** 66 testes automatizados aprovados; três testes completos de navegador aprovados; lint e build aprovados. Foram preservados os 57 testes da revisão Baileys anterior, incluindo nove cenários de queda/recuperação da fila. Nove novos testes cobrem backend autônomo com login expirado e conexões HTTP fechadas, cron/fluxo/recebimento, supervisor sem processo iniciador, reinício sem replay de campanha concluída, parada persistente e durante envio, backoff, rotação, ambiente absoluto, preparação da tarefa, parada sem logout e reconexão. O teste preparatório anterior da Cloud API continua na suíte, sem representar integração ativa.

As evidências anteriores de instalação limpa, execução HTTP e proxy de desenvolvimento foram conferidas e preservadas; dependências e requisitos de instalação não foram alterados nesta revisão. Veja [instalacao.json](validacao/instalacao.json), [instalacao.txt](validacao/instalacao.txt) e [proxy-dev.json](validacao/proxy-dev.json).

Os comandos finais e seus resultados constam em [verificacoes.json](validacao/verificacoes.json), com saídas completas em [testes.txt](validacao/testes.txt), [lint.txt](validacao/lint.txt), [build.txt](validacao/build.txt) e [navegador.txt](validacao/navegador.txt). O manifesto de arquivos e hashes está em [arquivos.json](validacao/arquivos.json).

A revisão de escopo Baileys, os arquivos desta revisão, a preservação do adaptador inativo e os limites da validação estão em [revisao-baileys.json](validacao/revisao-baileys.json). As telas de chat e conexão foram conferidas novamente: exibem a política interna e a suspensão operacional, sem configuração oficial.

Os novos resultados de execução em segundo plano estão em [background.json](validacao/background.json). O XML foi preparado, mas registrar/iniciar/parar a tarefa como SYSTEM e testar boot real permaneceram sem execução administrativa; [windows-task.json](validacao/windows-task.json) registra essa distinção. O supervisor foi exercitado com subprocessos reais fora do Agendador. Nenhum teste enviou mensagens reais.

Uma nova instalação limpa executou npm ci offline, build e backend compilado em pasta isolada, iniciado fora da raiz. O frontend respondeu 200, a saúde sem login respondeu 401 e a parada por IPC retornou 0, preservando credenciais sintéticas e liberando ambos os locks. Veja [instalacao-background.json](validacao/instalacao-background.json) e [saída completa](validacao/instalacao-background.txt). A revisão anterior de 57 testes permanece em [verificacoes anteriores](validacao/baileys-anterior/verificacoes.json).

| Cobertura | Arquivo de teste |
|---|---|
| 1.000 contatos / 25 lotes / 24 intervalos, pausa no 17, modo manual, cancelamento, retry, audiência >10.000, recibos e idempotência | test/queue.test.cjs |
| Processos reais encerrados à força durante envio, intervalo e pausa; sucesso do provedor antes do commit; segunda instância; restrição após reinício | test/process.test.cjs e test/process-worker.cjs |
| Fluxos, sessão persistente, fim vazio, categoria, atraso único, cadência conjunta e 24 h por contato | test/flows.test.cjs |
| Login, API protegida, CSRF/CORS, webhook, opt-out e métricas | test/api.test.cjs |
| SQLite, WAL, backup/restauração, chaves estrangeiras e migração incremental | test/storage.test.cjs |
| setup-admin e servidor reais com HTTP; CLI de restauração | test/runtime.test.cjs |
| Socket único; logout durante inicialização/gravação; Baileys integrado ao despachante sem janela promocional de 24 h; inbox deduplicada, opt-out, restrição/reconexão e falha incerta, com SDK/autenticação sintéticos | test/connection.test.cjs |
| Backend com login expirado e sem HTTP; cron, entrada, fluxo, WAITING_REPLY, cancelamento de fluxo, rotação e preparação de tarefa | test/autonomy.test.cjs e test/autonomy-worker.cjs |
| Processo iniciador encerrado, supervisor vivo, reinício sem replay, parada persistente, backoff e ambiente independente do cwd | test/supervisor.test.cjs |
| Login, campanha, pausa 17/recarga/saldo 23/cancelamento, seleção entre páginas, CSV, formulário de fluxo, chat, regra ONCE, CRM e revisão de restrição | test/browser/campaign.spec.cjs |

Os testes de processo usam arquivos SQLite temporários e subprocessos Node reais, mortos por SIGKILL. O provedor é um substituto local que registra aceitação antes do encerramento. Não é uma conta de WhatsApp. Os testes de navegador usam Edge headless e um servidor separado em 127.0.0.1:3187, sem executar server/index.js sobre o banco real.

Capturas da validação: [campanha pausada após 17](validacao/campanha-pausada17.png), [intervalo do lote](validacao/campanha-intervalo.png), [seleção entre páginas](validacao/selecao-entre-paginas.png), [chat](validacao/chat-paginado.png), [fluxo salvo](validacao/fluxos.png) e [conta restrita](validacao/conta-restrita.png).

## 9. Limitações e pendências específicas

- O funcionamento pelo WhatsApp depende do Baileys e da compatibilidade de sua versão com o serviço. Bloqueios nem sempre fornecem sinal inequívoco; o operador pode precisar registrar a restrição na tela de conexão. A liberação continua manual.
- Pareamento, reconexão, entrega/leitura e mídia com a conta real não foram validados nesta execução, por instrução de não enviar nem alterar o pareamento.
- Resultados incertos não têm resolução automática garantida. Não há garantia de exatamente uma vez, inclusive após restaurar um backup antigo.
- Uma instalação, um host e uma sessão principal; sem vários operadores, empresas ou números.
- O processo Node precisa permanecer ativo. A tarefa Windows e o supervisor estão implementados, mas o registro de produção precisa ser executado como Administrador; esta sessão não permitiu instalar/verificar a tarefa. Não houve reboot real nem publicação de servidor externo.
- XLS/XLSX direto, uploads de mídia, CRM de saída e adaptadores específicos de CRM continuam ausentes.
- Retry automático limitado é aplicado a destinatários de campanha. Falhas de trabalhos individuais de chat/fluxo são registradas e exigem revisão operacional.
- O arquivo server/data.json permanece como legado sem uso pelo servidor. Configurações CRM existentes foram preservadas; chaves antigas que tenham sido compartilhadas/versionadas devem ser rotacionadas na tela CRM antes de exposição externa.
- A lista visual mostra as 200 campanhas mais recentes; os destinatários e históricos por conversa são paginados no servidor.
- O build tem avisos do Vite sobre configuração ESM em arquivo .js e tamanho do bundle; eles não impedem a compilação. Não foi realizada auditoria externa de vulnerabilidades nem teste de carga.
