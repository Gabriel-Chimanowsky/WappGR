# Validação da migração Cloud API — 29/10/2026

A integração foi concluída no código local e validada com serviços simulados. **Não houve teste em recursos oficiais Meta, envio real, migração do número ou publicação na Contabo.** O banco operacional local permanece no esquema v2; a migração v3 e sua revisão obrigatória foram exercitadas em bancos isolados.

## Resultados reproduzíveis

Ambiente: Windows, Node 24.19.0, npm 11.17.0, Microsoft Edge headless. As suítes usam SQLite real, HTTP local e processos reais quando aplicável. Token, IDs, catálogo, relógio, mensagens, recibos e tarifas são sintéticos; `v99.0` é somente um marcador de teste.

O [manifesto final](validacao/cloud-verificacoes.json) registra códigos de saída, totais, escopo e hashes dos arquivos implementados e das evidências.

Na retomada final, o log confirmou os oito cenários de navegador concluídos. A comparação dos 38 hashes de código e das evidências não encontrou divergências; os resultados de lint, build e testes foram reaproveitados sem alteração funcional posterior.

| Comando | Resultado | Evidência |
|---|---|---|
| `npm.cmd test` (inclui build pelo pretest) | 80 testes aprovados, 0 falhas, 0 ignorados | [Log completo](validacao/cloud-tests.txt) |
| `npm.cmd run test:browser` | 8 cenários aprovados, processo encerrado com código 0 | [Log do navegador](validacao/cloud-browser.txt) |
| `npm.cmd run lint` | Código 0, sem diagnósticos | [Log do lint](validacao/cloud-lint.txt) |
| Build Vite | Compilação concluída; avisos sobre formato futuro da configuração e tamanho do bundle | Incluído no log da suíte |
| Backup anterior | `integrity_check=ok`, nenhuma violação de chave estrangeira, esquema v2 | [Identidade, tamanho e SHA-256](validacao/cloud-backup.json) |
| Inspeção visual | Campanhas, configurações, agendamentos e editor de fluxos inspecionados em 1440 × 1100, com rolagem | Capturas abaixo |

Os logs mantêm avisos emitidos em stderr. O PowerShell pode registrá-los com a apresentação `NativeCommandError`; os códigos de saída e os resumos dos executores acima distinguem esses avisos de falhas. A falha de gravação de webhook registrada na suíte é injetada deliberadamente para verificar que o servidor não confirma persistência inexistente.

## Cobertura funcional

| Requisito | Evidência executável |
|---|---|
| Exatamente Serviço, Utilidade e Marketing; nenhuma seleção inicial; ativação exige categoria | `cloud.test.cjs`: enum e ativação dos três módulos. `browser/cloud.spec.cjs`: três radios sem seleção inicial, erros visíveis e rascunhos. |
| Salvar, editar, recarregar e trocar categoria explicitamente | Navegador: campanha Marketing → Serviço, remoção explícita do modelo anterior e recarga; regra e fluxo persistidos. |
| Categoria padrão do fluxo, herança e substituição explícita | Backend e navegador verificam categoria efetiva, etapa herdada nula e override Marketing com modelo. |
| Modelo aprovado e compatível, sem campos Graph inventados | Catálogo paginado, cache vencido, pausa, rejeição, remoção, reclassificação e mudança de conteúdo; payload simulado sem categoria interna. |
| Janela individual imediatamente antes do envio | Limite exato de 24h, destinatários diferentes, atraso, pausa/retomada, recuperação e expiração durante preparação de mídia. Histórico antigo e envio da empresa não renovam a janela. |
| Revisão dos registros antigos | Migração v2 → v3 com WAL, backup íntegro, restrição/histórico conservados e nenhuma execução automática. Navegador bloqueia retomada antes da revisão. |
| Segredos somente no servidor | API sem login e sem CSRF recusada; token no formulário recusado; respostas e configurações sem valores secretos; tentativa de trocar identidade vinculada recusada. |
| Estimativa desconhecida não vira zero | Tarifas versionadas sintéticas com moeda/fonte/vigência; cobertura incompleta/vencida e orçamento insuficiente bloqueiam conforme configuração. Telas mostram “Estimativa indisponível”. |
| Pausa após 17 e saldo de 23 | Suíte de fila e navegador: pausa/recarga/retomada do lote de 40, mantendo cadência e audiência; cancelamento conserva histórico. |
| Autonomia e ausência de fallback | Backend real sem conexão HTTP e após expiração do login; cron, fluxo, entrada e fila continuam. Inicialização padrão não importa Baileys, não cria QR e preserva arquivos antigos. |
| Webhook durável e associação de IDs | HMAC dos bytes brutos, verify token distinto, persistência antes do ACK, deduplicação, entrada sem sessão e IDs oficiais vinculados à correlação interna. |
| Aceite, entrega, leitura, falha e incerto | Aceite não conta como entrega; recibos repetidos/fora de ordem, recibo antes da resposta, falha anterior ao aceite e recibo tardio de incerto, sem duplicar envio. |
| Fluxos e mídia | Áudio sem legenda Graph; acompanhamento em texto separado. Sessões aguardam nova entrada quando a janela expira; desativação cancela também jobs em espera/suspensão. |
| Recuperação e encerramento | Testes de processos/supervisor: iniciador termina, filho continua, reinício sem repetir campanha, locks, backoff, parada persistente e envio interrompido incerto. |

As verificações anteriores de fila, consentimento, importação, API, armazenamento, processos, supervisor e navegador foram mantidas. Testes antigos do adaptador Baileys continuam isolados para preservar regressões históricas; isso não significa que o transporte esteja ativo no produto.

## Correções da retomada

- Radios receberam nomes acessíveis explícitos; seletores passaram a identificar a opção, sem depender da descrição do cartão.
- A edição Marketing → Serviço agora envia `template: null`, removendo o modelo no PATCH. O teste continua exigindo a categoria nova após salvar e recarregar.
- Falha oficial anterior à resposta HTTP permanece `FAILED`; aceite posterior não apaga o erro nem permite retry automático.
- A fixture de navegador limpa somente seu banco sintético entre cenários e encerra pelo endpoint local de teste; não depende de WMI para matar uma árvore de processos.
- Rótulos de conexão e de categoria do contato foram esclarecidos. O editor informa herança/substituição; configuração distingue presença de credenciais de homologação de envio.
- Áudio com legenda em campanha/regra é recusado com orientação explícita. Fluxo usa uma mensagem de acompanhamento separada, sujeita à janela.

## Evidências visuais

Somente dados sintéticos. Os arquivos são capturas do navegador, sem montagem ou edição:

- [Categoria, modelo filtrado e estimativa indisponível](validacao/cloud-template.png).
- [Categoria padrão e substituição no editor de fluxo](validacao/cloud-flow-editor.png).
- [Agendamento em revisão](validacao/cloud-schedule.png).
- [Configuração, catálogo e tarifas sem exposição de segredos](validacao/cloud-configuration.png).
- [Campanha pausada na tentativa 17](validacao/cloud-paused17.png).

## Limites e próxima etapa externa

**Simulação local:** concluída conforme os resultados acima. A migração de esquema não foi aplicada ao banco operacional; backup e configurações locais foram preservados.

**Homologação oficial:** pendente. Requer ativos de teste Meta, versão Graph vigente confirmada, token/escopos, DNS/TLS, subscrição, modelos aprovados, mídia real e recibos reais. Nenhum teste sintético comprova que a Meta acessa o webhook ou aceita um modelo da conta. Consultas GET de permissões não comprovam permissão efetiva de envio nem entrega.

**Operação real:** não executada. Depende da homologação, revisão dos registros antigos e configuração administrativa. Registro Windows como SYSTEM/reboot real e validação de Nginx/PM2 na Contabo também não foram executados nesta migração.

O portal técnico direto da Meta retornou HTTP 429. Foram consultadas as fontes primárias públicas indicadas no [guia de configuração](CLOUD_API.md); versão Graph, webhooks opcionais, particularidades de modelos/cobrança e retorno de correlação devem ser confirmados na versão adotada. Não há versão de produção presumida, endpoint de tarifas inventado ou promessa de gratuidade pela seleção de categoria.

Para atualizar a Contabo posteriormente, siga [CLOUD_API.md](CLOUD_API.md#contabo-procedimento-preparado-não-executado), os exemplos dedicados em `deploy/` e a revisão dos ativos Meta. Os procedimentos preservam banco, `.env`, histórico, backups e demais sites; não foram executados nesta etapa.
