# Operação autônoma do WappGR no Windows

**16/10/2026 — Baileys exclusivo, Node 24, aplicação compilada.** Não são necessários Vite em execução, navegador, operador conectado, Redis ou um gerenciador externo de processos.

## Situação desta máquina

A implementação e os testes com processos reais estão disponíveis. **A tarefa de produção não foi registrada por esta execução:** a sessão não é Administrador. A consulta final ao Agendador confirmou NOT_INSTALLED; no ambiente restrito, a consulta havia retornado acesso negado. O XML foi preparado em `server/runtime/task.xml` e validado pelo parser nativo do Agendador em memória. Isso não confirma instalação. Os resultados constam em [windows-task.json](validacao/windows-task.json) e [background.json](validacao/background.json).

O supervisor foi iniciado e parado em testes isolados, inclusive após o processo iniciador terminar. Registro como SYSTEM, execução antes do login, permissões dessa identidade e inicialização após um reboot real continuam dependendo da configuração administrativa da máquina.

## Instalar e iniciar

Abra **PowerShell como Administrador** e use:

~~~powershell
Set-Location -LiteralPath 'C:\xampp\htdocs\WappGR'
npm.cmd ci
npm.cmd run build
npm.cmd run service:install
npm.cmd run service:start
npm.cmd run service:status
~~~

Em uma instalação nova, execute `npm.cmd run migrate` e `npm.cmd run setup-admin` antes de iniciar. Preserve um administrador já existente. Não execute esses comandos de manutenção enquanto o backend estiver ativo.

A instalação registra a tarefa `WappGR-Backend`, com gatilho de inicialização do Windows, espera de 30 segundos e identidade **SYSTEM**, sem exigir login ou guardar senha de usuário. **Instalar não inicia imediatamente** outra instância; `service:start` inicia e verifica o processo e o heartbeat. Após a instalação, a tarefa está habilitada para o próximo boot, exceto se houver uma parada administrativa persistida. A interface compilada fica em `http://127.0.0.1:3001`; abrir essa página é opcional para a execução.

O comando de instalação recusa sobrescrever uma tarefa de mesmo nome com outros caminhos. Task Scheduler usa IgnoreNew; supervisor, banco e diretório de credenciais também têm locks por PID/host. Uma instância manual existente não é adotada nem encerrada automaticamente: pare-a antes de usar `service:start`. Mesmo com outro banco, a mesma pasta de credenciais não admite um segundo backend.

O Node, supervisor, diretório de trabalho e arquivo de ambiente são gravados com **caminhos absolutos**. O `.env` padrão é o da raiz do projeto, independentemente do diretório de quem iniciou o processo. Variáveis fornecidas ao processo têm precedência sobre o arquivo. Para usar outro arquivo, informe o mesmo caminho absoluto em todos os comandos:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\xampp\htdocs\WappGR\scripts\windows.ps1' install -EnvFile 'C:\config\wappgr.env'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\xampp\htdocs\WappGR\scripts\windows.ps1' start -EnvFile 'C:\config\wappgr.env'
~~~

`ExecutionPolicy Bypass` vale somente para esse processo PowerShell; não altera a política permanente da máquina. `install -PrepareOnly` apenas prepara o XML. O script não muda energia, firewall, rede, credenciais ou ACLs da aplicação.

Foi escolhida uma tarefa nativa com [gatilho e identidade de serviço do Agendador](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps), evitando instalar um wrapper de serviço. [Configurações do Agendador](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps) permitem execução sem limite de duração e recuperação do supervisor. O supervisor controla a recuperação do backend, com espera progressiva e diagnóstico persistido.

## Comandos de operação

Execute-os no mesmo projeto, como Administrador:

| Comando | Efeito |
|---|---|
| `npm.cmd run service:install` | Registra e verifica a tarefa; não inicia um backend imediatamente |
| `npm.cmd run service:start` | Inicia e aguarda confirmação de processo/saúde; chamadas repetidas não duplicam instâncias |
| `npm.cmd run service:stop` | Solicita encerramento controlado e persiste a intenção de parada |
| `npm.cmd run service:status` | Mostra registro da tarefa, PIDs, heartbeat, loops, última atividade e suspensões |
| `npm.cmd run service:remove` | Para, verifica e remove a tarefa; conserva banco, credenciais, backups e logs |

Depois de `service:stop`, o sistema **continua parado mesmo após reiniciar o Windows**, até `service:start`. Não apague `server/runtime/stop.json` manualmente. O comando start remove essa intenção e permite nova tentativa após corrigir configuração inválida; ele não libera restrições da conta, pausas de campanha ou resultados incertos.

Encerrar um processo à força pelo Gerenciador de Tarefas é tratado como falha. Para uma parada administrativa, use o comando próprio. O supervisor solicita saída por IPC, aguarda a chamada em andamento por até 35 segundos e pode forçar o encerramento após 40 segundos. O script aguarda até 45 segundos antes de recorrer ao encerramento da tarefa. Operações interrompidas continuam sujeitas à regra de resultado incerto.

## O que permanece executando

| Recurso | Comportamento sem frontend |
|---|---|
| Campanha/broadcast | Despachante continua a audiência persistida, até concluir, pausar, cancelar ou encontrar bloqueio; conclusão não reinicia campanha |
| Recorrência | Cron do backend gera ocorrências enquanto a regra estiver ativa; ONCE executa uma vez |
| Fluxo | Inbox, gatilhos, etapas, atrasos e expiração são processados no backend; etapa WAITING_REPLY espera resposta sem repetir envio |
| Desativação de fluxo | Impede novos gatilhos, cancela trabalhos pendentes e encerra sessões; chamada já entregue ao SDK não pode ser desfeita |
| Recebimento e respostas | Callbacks Baileys persistem a entrada; processamento e respostas passam pela fila compartilhada |
| Login expirado | Impede novos comandos administrativos; não invalida trabalhos já autorizados |

Os loops iniciam junto com o backend: despachante a cada 250 ms e cron/fluxos a cada segundo. Não pertencem a uma requisição, cookie ou tela. Timers da interface só consultam estado. Consentimento, opt-out, janela interna de atendimento, expiração de sessão de fluxo e elegibilidade continuam aplicados.

## Recuperação e desconexão

Falha inesperada do backend provoca esperas de **30 s, 60 s, 120 s, 300 s e 600 s**. Após seis falhas consecutivas, o supervisor fica BLOCKED até correção e `service:start`. Uma execução estável por cinco minutos permite reiniciar a contagem na próxima falha. Erros de configuração, build ausente, permissão, porta ocupada ou lock retornam código 78 e bloqueiam a recuperação imediata. A espera e o bloqueio sobrevivem a um novo início do supervisor.

A própria tarefa pode reiniciar um supervisor que falhou até três vezes, com intervalo de um minuto. Parada administrativa e BLOCKED encerram normalmente e não acionam essa recuperação. O supervisor monitora heartbeat e chamadas do despachante; ausência de atividade por 120 segundos inicia encerramento controlado antes de outra tentativa.

Na recuperação, são reutilizados destinatários, lote parcial, saldo, cadência e próximo horário persistidos. Pausas, cancelamentos e restrições permanecem; chamadas interrompidas ficam UNCERTAIN, sem retry automático. O cron recupera no máximo uma ocorrência vencida e não dispara todo o histórico de horários perdidos.

Desconexão comum segura novas tentativas, sem consumir toda a audiência em falhas. O Baileys tenta reconectar com esperas de 5 s, 15 s, 30 s, 60 s e até 5 min, reiniciadas após uma conexão aberta. Falhas de rede reconhecidas durante inicialização também podem reconectar sem operador quando há credenciais. Falhas de configuração/credenciais precisam de revisão. Logout e sinal de restrição 403 não iniciam reconexão automática; reconectar manualmente também não remove o bloqueio persistido da conta.

## Logs e diagnóstico

Por padrão, o estado fica em `server/runtime/` (ou no diretório configurado por WAPPGR_RUNTIME_DIR):

- `supervisor.json`: PID, filho, estado, falhas, motivo e próxima tentativa.
- `health.json`: heartbeat do backend, despachante, atividade, conexão e suspensões, sem QR Code ou credenciais.
- `logs/supervisor.log`: início, saída, espera e bloqueio de recuperação.
- `logs/backend.log`: stdout/stderr capturados pelo supervisor.
- `logs/runtime.log`: início, parada e erros dos loops de automação.

Cada log gira ao atingir 5 MiB e conserva cinco arquivos anteriores. Acompanhar logs é opcional e não sustenta o processo:

A substituição atômica de arquivos de estado faz tentativas curtas e limitadas quando o Windows informa compartilhamento ocupado. Uma falha permanente do supervisor é registrada, e o filho recebe pedido de encerramento antes de uma recuperação. Rotação mantém uma cópia e trunca o log ativo quando um leitor impede renomeá-lo; reabra o acompanhamento após rotação se necessário.

~~~powershell
Get-Content -LiteralPath 'C:\xampp\htdocs\WappGR\server\runtime\logs\runtime.log' -Tail 50 -Wait
~~~

`GET /api/v1/health` oferece o diagnóstico com sessão administrativa. Sua expiração não interrompe os loops; `service:status` consulta os arquivos locais sem login no site. RUNNING indica processo operacional, e `suspensionReasons` explica por que não envia, por exemplo desconexão, pausa ou restrição. Se o Windows negar a consulta ao Agendador, o comando informa `taskState: UNKNOWN`, sem afirmar que a tarefa está ausente.

## Manutenção e identidade

SYSTEM precisa ler o Node, código, build e `.env` e modificar banco, arquivos WAL, runtime e a pasta Baileys. O instalador **não copia credenciais**, não as inclui no XML e não troca de pareamento. Guarde o projeto em volume local disponível antes do login; não use unidade mapeada da sessão do usuário. O código executado por SYSTEM deve ficar gravável somente por identidades confiáveis. As permissões efetivas precisam ser conferidas na máquina administrada.

Para atualizar ou fazer backup/restauração, pare o backend com `service:stop`, execute a manutenção, compile quando necessário e use `service:start`. A restauração mantém o bloqueio de conta e a reconciliação conservadora já documentados. Não há nova migração de esquema nesta entrega.

**Computador desligado, suspenso ou sem internet não envia mensagens.** A tarefa não liga o computador, não evita suspensão e não altera energia. Sem credenciais válidas ou com conta restrita, executar o backend não garante disponibilidade do WhatsApp.

## Validação e limites

Os [testes registrados](validacao/verificacoes.json) incluem processos reais com transporte sintético. `test/autonomy.test.cjs` fecha conexões HTTP e expira o login enquanto a campanha continua, executa cron/fluxo/entrada sem frontend, verifica WAITING_REPLY e cancela trabalho de fluxo desativado. `test/supervisor.test.cjs` encerra o processo iniciador, observa o backend vivo, mata/reinicia o filho sem repetir campanha concluída, recusa segunda instância e comprova parada persistente, backoff e bloqueio de configuração. Também para durante envio e comprova que a recuperação conserva um incerto, conclui os outros sete e não repete o primeiro destinatário. Testes anteriores de queda, lote 17/40, saldo 23, pausa, cancelamento, opt-out e restrição foram reaproveitados.

`npm.cmd run test:windows-task`, como Administrador, registra uma tarefa temporária isolada, com WhatsApp desabilitado e caminhos sintéticos, verifica gatilho, início, comando repetido, parada e preservação de credenciais e remove a tarefa ao final. Sem privilégios, registra explicitamente que essas etapas não foram executadas. Nem esse teste nem esta entrega reiniciam o Windows. Pareamento, mídia e recibos com conta real continuam fora da validação; não foram enviados recados reais.
