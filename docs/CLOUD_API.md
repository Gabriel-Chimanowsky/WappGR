# WappGR — operação com a Cloud API da Meta

**29/10/2026.** A Cloud API é o transporte operacional do backend. Esta decisão substitui a configuração anterior exclusiva de Baileys. React, Express, SQLite, Node 24, autenticação, fila por destinatário, lotes, cadência, consentimento, cron e sessões de fluxo foram mantidos. Não houve publicação na Contabo, registro/migração de número nem envio real nesta implementação.

## Configurar a conta

1. Disponibilize uma conta WhatsApp Business (WABA), aplicativo Meta e Phone Number ID. Para homologação futura, comece com os recursos oficiais de teste da sua conta e destinatários autorizados. A aplicação não registra nem migra números.
2. Configure um token de usuário do sistema no servidor, com acesso aos ativos e permissões `whatsapp_business_messaging` e `whatsapp_business_management`. A coleção oficial da Meta confirma essas permissões; `business_management` é necessário apenas para operações adicionais sobre o portfólio, que este projeto não executa. [Coleção oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-d0e227d1-e520-4b12-a8f6-32657a52d26e).
3. Preserve o `.env` existente e acrescente as variáveis de [.env.example](../.env.example). Preencha `WAPPGR_CLOUD_TOKEN`, `WAPPGR_META_APP_SECRET` e `WAPPGR_WEBHOOK_VERIFY_TOKEN` somente no servidor. São três segredos diferentes. Não use prefixo `VITE_`, não envie tokens pela conversa e não os inclua em comandos que fiquem no histórico.
4. Configure `WAPPGR_CLOUD_WABA_ID`, `WAPPGR_CLOUD_PHONE_NUMBER_ID` e `WAPPGR_GRAPH_VERSION`. Alternativamente, salve esses três identificadores públicos na área **Conectar WhatsApp**. Variáveis não vazias de ambiente prevalecem sobre a tela.
5. **Não há versão Graph implícita.** Informe uma versão atualmente suportada pelo seu aplicativo, confirmada no painel/changelog Meta. `v99.0` aparece exclusivamente em testes sintéticos e não é uma recomendação de versão real.
6. Use **Testar permissões sem enviar**. São consultas GET do número, dos números pertencentes à WABA e do catálogo. Isso não prova a permissão de envio, o faturamento ou a entrega: confira os escopos no painel Meta e execute uma homologação oficial separada quando autorizado.
7. Use **Sincronizar modelos**. Nenhum envio é necessário para sincronizar. O banco fica vinculado ao par WABA/Phone Number ID; alterar variáveis para outra conta não transfere a identidade dos trabalhos existentes.

Tokens e segredos não são salvos nas tabelas de configuração, devolvidos pelas rotas gerais nem incorporados ao frontend. O status informa somente presença/ausência. As chamadas usam Authorization no cabeçalho, nunca tokens na URL. Respostas de erro da Meta são convertidas em mensagens locais sem despejar cabeçalhos ou respostas sensíveis. Preserve também a confidencialidade dos backups, do banco e das credenciais antigas.

## Webhook HTTPS

O endpoint público é `https://SEU-DOMINIO/api/webhooks/whatsapp`. Porta 8081 por HTTP não é configuração final de webhook de produção. Use DNS correto, certificado TLS válido e um virtual host dedicado. [Exemplo Nginx](../deploy/nginx.wappgr.conf.example).

- O GET compara `hub.verify_token` com `WAPPGR_WEBHOOK_VERIFY_TOKEN` e devolve `hub.challenge` somente em uma verificação válida.
- O POST verifica `X-Hub-Signature-256` por HMAC SHA-256 com **App Secret**, sobre os bytes do JSON recebido antes de parsear. Assinatura inválida recebe 401; falha de persistência não recebe confirmação de sucesso.
- Mensagens e estados são recebidos pelo campo `messages`, para a WABA e o Phone Number ID configurados. Configure também, quando oferecidos pelo aplicativo/conta, `message_template_status_update`, `template_category_update`, `message_template_quality_update` e `account_update`. Confirme no painel os nomes e a disponibilidade dos campos opcionais: o portal técnico não permitiu verificá-los integralmente nesta sessão.
- Habilite a subscrição do aplicativo à WABA no ambiente Meta. O WappGR não efetua subscrição, registro de telefone ou alterações no portfólio automaticamente.
- Desative o log da query string deste endpoint no proxy: a verificação inicial contém o token de verificação. O exemplo fornecido desativa o access log desta rota.

Os eventos são gravados em `cloud_events` antes do HTTP 200. O backend processa a caixa de entrada independentemente de login do navegador, com deduplicação e transações. Mensagens recebidas atualizam `cloud_last_inbound_at` individualmente, usando o instante do provedor, limitado ao recebimento local. Histórico Baileys e mensagens da empresa não abrem a janela oficial.

`cloud_message_links` associa o ID oficial ao identificador interno da tentativa. O identificador de correlação enviado em `biz_opaque_callback_data` não é chave de idempotência da Meta. Eventos ainda sem associação permanecem pendentes; eles não provocam reenvio. `messages.whatsapp_msg_id` só recebe um ID oficial quando há resposta ou evento correspondente. Eventos brutos permanecem disponíveis para auditoria e reconciliação.

A coluna histórica `status=SENT` significa **aceitação** no WappGR; `provider_status` separa `ACCEPTED`, `SENT`, `DELIVERED`, `READ` e `FAILED`. Entrega/leitura só vêm de recibos. Um estado lido não regride com um evento enviado ou falhado atrasado. Timeout, queda e resposta ambígua ficam `UNCERTAIN`, sem retry automático. Código de credencial inválida ou permissão ausente não é apresentado como banimento.

Verificação externa pendente: concluir o GET no painel Meta, receber um evento de teste assinado, conferir a persistência e os estados em **Diagnóstico dos webhooks**. O teste local de assinatura não comprova DNS, TLS, subscrição ou acesso da Meta ao servidor.

## Selecionar a categoria e configurar o conteúdo

O enum compartilhado é `SERVICE`, `UTILITY`, `MARKETING`, exibido como **Serviço**, **Utilidade**, **Marketing**. Nenhuma opção vem selecionada em novos formulários. Rascunhos podem ficar incompletos; ativação, agendamento e início exigem categoria e configuração válidas no servidor.

| Escolha | Conteúdo e condição de execução |
|---|---|
| Serviço | Texto livre, imagem, vídeo, áudio ou documento por URL HTTPS autorizada. Cada cliente deve ter enviado mensagem há menos de 24 horas. No limite exato, a janela está encerrada. |
| Utilidade | Modelo aprovado `UTILITY`, para pedido, solicitação, agendamento, transação ou conta existente. Registre a referência relacionada quando aplicável. Selecionar Utilidade não converte promoção em mensagem transacional. |
| Marketing | Modelo aprovado `MARKETING`, com consentimento atual. Recusas, limites da plataforma e restrições da conta continuam aplicados. |

**Categoria interna não é um parâmetro de envio da Graph API.** O payload externo contém `type=text/image/video/audio/document` ou `type=template` e, neste último caso, nome, idioma e componentes parametrizados. O texto fixo aprovado é mostrado somente para leitura. Os nomes internos de categoria, orçamento e revisão não são enviados como campos inventados do endpoint `/messages`. O endpoint e os formatos básicos são documentados na [coleção oficial Meta — Messages](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages).

Os modelos persistem ID, nome, idioma, categoria aprovada, componentes, mapeamento de parâmetros, hash de conteúdo e data de sincronização. Parâmetros podem usar valores literais ou nome, telefone e categoria do contato. Há suporte a corpo/cabeçalho de texto, cabeçalho de mídia e URL dinâmica de botão. Componentes especiais não implementados, como carrosséis e localização, são rejeitados explicitamente; não são simulados. Botões de resposta rápida aprovados podem existir no modelo, sem payload customizado neste escopo. OTP/autenticação não é oferecido.

Nas mensagens livres dos fluxos, opções do WappGR são apresentadas como linhas de texto com palavra/número de resposta; não são transformadas em botões interativos Graph. Áudio não tem legenda nativa: em fluxos, o texto de acompanhamento usa uma segunda mensagem de Serviço, sujeita à mesma janela. Mídia é entregue por link HTTPS de domínio permitido em `WAPPGR_MEDIA_HOSTS`; o servidor não faz upload local nem promete exibir downloads de anexos recebidos. Entradas não textuais são preservadas no evento e representadas no chat pelo tipo/legenda.

## Fluxos e exemplos

Cada fluxo tem categoria padrão. Uma etapa herda esse valor, ou o operador marca **Substituir categoria nesta etapa** e seleciona uma das três opções. O editor mostra a categoria efetiva e se foi herdada. Cada etapa de Marketing/Utilidade seleciona seu próprio modelo compatível. Mudanças não convertem categorias automaticamente.

Exemplo: fluxo padrão Marketing, primeira etapa com modelo promocional aprovado e parâmetro de nome. Após a resposta do cliente, uma etapa com substituição explícita para Serviço envia o atendimento livre. Se houver atraso e a janela expirar, a sessão fica `WAITING_CUSTOMER`, conservando etapa e motivo. Nova entrada válida permite continuar; não há loop de envios para uma janela fechada. Erros de modelo deixam a sessão para revisão. A prévia estima por etapa e audiência atual; ramos, respostas e repetições impedem prometer um total exato.

Exemplo de broadcast: selecionar Marketing, modelo aprovado `novidades` no idioma disponível e parâmetros, audiência com consentimento, lote de 40, intervalo de 7.200 segundos e orçamento na moeda da tabela. Revise elegibilidade e custo antes de salvar. Pausar após 17 tentativas mantém as 23 vagas restantes; retomar não antecipa o intervalo nem reinicia a audiência. Um broadcast de Serviço mostra quantos estão fora da janela e registra o motivo de contatos que perdem a elegibilidade durante a execução.

Chat e respostas de consentimento usam Serviço. Opt-in não autoriza texto livre fora da janela. A mesma fila atende chat, campanhas, cron, fluxos e confirmações, revalidando consentimento, identidade, restrições e janela imediatamente antes da chamada.

## Catálogo, falhas e recuperação

O backend sincroniza o catálogo paginado a cada aproximadamente cinco minutos. O TTL máximo permitido para envio é cinco minutos; uma consulta malsucedida não renova o cache. Eventos pertinentes invalidam modelos imediatamente, exigindo novo GET. Pausa, rejeição, remoção, reclassificação ou mudança de conteúdo suspendem trabalhos afetados. A configuração anterior fica no histórico; a intenção e o orçamento não são alterados silenciosamente. O estado da Meta pode mudar entre uma consulta válida e a chamada: a resposta da API também é tratada, sem fallback de categoria ou transporte.

| Motivo | Ação |
|---|---|
| `WINDOW_EXPIRED` | Aguardar nova mensagem do cliente; revisar a etapa se necessário. Não reenviar nem trocar categoria automaticamente. |
| `TEMPLATE_UNAVAILABLE`, `TEMPLATE_CHANGED`, `CATEGORY_MISMATCH` | Sincronizar, selecionar modelo compatível e revisar cada trabalho. |
| `TEMPLATE_STALE` | Corrigir a consulta e sincronizar antes de continuar. |
| `INVALID_CREDENTIAL`, `PERMISSION_DENIED` | Corrigir token, permissões ou ativos no servidor/painel; não liberar uma restrição real por esse motivo. |
| `RATE_LIMIT`, `TRANSIENT` | Retry de campanha somente se a recusa for inequívoca, com backoff e limite persistidos. Jobs interativos com falha exigem revisão. |
| `ACCOUNT_RESTRICTED` | Revisão operacional da conta e continuação explícita; reinício ou passagem do prazo não liberam a fila. |
| `UNCERTAIN` | Aguardar recibo/reconciliar. Nenhum reenvio automático cego. |
| `BUDGET_EXCEEDED`, `BUDGET_UNAVAILABLE` | Corrigir tarifa/orçamento e revisar antes de continuar. |

O processo continua sem navegador. Locks do banco e diretório preservado de autenticação impedem coexistência acidental com uma instância anterior. Os módulos legados permanecem no repositório como histórico e para regressões isoladas, mas o backend padrão não os importa nem inicia sockets, QR ou fallback.

## Custos e orçamento

As [regras públicas de preços da Meta](https://business.whatsapp.com/products/platform-pricing) descrevem cobrança por mensagem entregue, variando por mercado/categoria, e condições de gratuidade. A implementação não fixa valores nem inventa API pública de tarifas. Importe versões na área administrativa com moeda, fonte HTTPS, início/fim de vigência e valores por prefixo internacional/categoria.

Formato de importação (os campos abaixo são descritivos, **não são tarifas utilizáveis**):

```text
currency: código ISO, por exemplo BRL
source: URL oficial da tabela conferida
effectiveAt / expiresAt: instantes ISO UTC de validade
rates: [{ prefix: DDI/prefixo de mercado, category: SERVICE|UTILITY|MARKETING, amount: valor numérico conferido }]
freeServiceWindow / freeUtilityWindow: true somente após conferir a regra vigente
```

O prefixo mais específico prevalece. Mercados com regra especial exigem prefixos suficientes na tabela. Para a moeda do orçamento, todos os destinatários precisam de cobertura. Sem tabela válida ou com moeda incompatível, a tela mostra **Estimativa indisponível**, nunca zero presumido. Gratuidade só é calculada quando a regra importada a confirma e existe evidência de janela aberta. Descontos por volume e janela gratuita de anúncios não são inferidos automaticamente; a estimativa é conservadora e pode superar a cobrança efetiva.

Cada tentativa registra sua estimativa e referência. Aceitos e incertos conservam a reserva estimada para que uma edição posterior mais barata não apague a exposição já assumida. Um orçamento com estimativa desconhecida bloqueia novas chamadas. O orçamento limita a estimativa operacional, não é garantia de teto na fatura externa. `pricing_json` conserva os dados efetivamente reportados, quando presentes, separadamente da intenção/modelo/formato; eventos não são uma fatura nem necessariamente informam um valor monetário.

## Atualização e revisão dos registros antigos

A migração **v3** usa `VACUUM INTO` para snapshot consistente incluindo WAL antes de alterar um banco existente. Não remove banco, campanhas, mensagens, configurações locais ou arquivos Baileys. Os registros antigos ficam sem categoria oficial, campanhas pendentes pausadas para revisão, fluxos/regras inativos e jobs legados suspensos. Entradas pendentes do provedor antigo não geram respostas Cloud API. Mensagens antigas conservam os IDs e são marcadas como histórico do provedor anterior, sem inventar evidência Meta.

Abra **Editar / revisar**, escolha categoria e modelo/parâmetros quando necessários, gere/confira a prévia e marque a confirmação de revisão. Depois continue ou ative explicitamente. Campanhas antigas sem audiência individual (`LEGACY`) continuam apenas como histórico; para novo envio, crie uma campanha revisada. Jobs antigos suspensos não são convertidos automaticamente em novos jobs cobrados. Chamadas interrompidas preservam o tratamento incerto.

O backup inicial desta execução foi `server/backups/manual-1793259986143.sqlite`: integridade `ok`, esquema v2, 2 campanhas, 17 mensagens, 1 fluxo, 0 contatos e 0 regras. Esse arquivo é local e ignorado pelo Git. O banco operacional local continua no esquema v2; os testes de migração usam outros bancos isolados e verificam backup, WAL, integridade, chaves estrangeiras e ausência de execução automática. A [evidência final](validacao/cloud-backup.json) inclui tamanho e SHA-256.

## Contabo: procedimento preparado, não executado

Ambiente: `/var/www/WappGR`, Node 24, processo PM2 `wappgr-backend`, Nginx. Preserve o usuário atual de serviço, os caminhos absolutos de dados e o `.env`. Não use `pm2 delete all`, não substitua o Nginx global e não altere outros virtual hosts.

1. Registre versão/caminhos atuais e confirme que é a única instância. Pare **somente** `wappgr-backend`: `pm2 stop wappgr-backend`. Aguarde a saída controlada; o arquivo [deploy/ecosystem.config.cjs](../deploy/ecosystem.config.cjs) usa 40 segundos de tolerância e uma instância fork. Não rode simultaneamente supervisor Windows e PM2 para o mesmo banco.
2. Em `/var/www/WappGR`, execute `npm run backup` antes da atualização. Copie o backup para armazenamento protegido. Preserve `.env`, `server/wappgr.db*`, `server/backups`, `server/runtime` e `server/baileys_auth` na distribuição do código.
3. Atualize somente os arquivos de aplicação revisados. Com Node 24 e o backend parado, execute `npm ci`, `npm run migrate`, `npm run build`. Não redefina o administrador existente; `setup-admin` é apenas para instalação nova.
4. Configure os segredos localmente; restrinja a leitura do `.env` ao usuário de serviço. Use `HOST=127.0.0.1`, `PORT=3001`, `WAPPGR_ORIGINS=https://SEU-DOMINIO`, `WAPPGR_TRUST_PROXY=loopback` e o caminho absoluto do `.env`. Ajuste simultaneamente porta e proxy se a instalação usar outra porta interna.
5. Prepare DNS e certificado. Aplique somente um virtual host WappGR baseado no exemplo Nginx, adaptando domínio/certificado. Emita/renove o certificado pelo procedimento já usado na VPS. Verifique `nginx -t` antes de recarregar o Nginx. O exemplo completo HTTPS só pode ser ativado depois que os arquivos do certificado existirem.
6. Para o processo existente correto, `pm2 restart wappgr-backend --update-env`; se for necessário reaplicar parâmetros, revise o arquivo de ecosystem e use `pm2 startOrReload deploy/ecosystem.config.cjs --only wappgr-backend --update-env`. Não execute comandos para todos os processos. Confirme Node 24 também no executável usado pelo PM2 (`WAPPGR_NODE_BIN` permite caminho explícito).
7. Confira `pm2 status wappgr-backend`, logs e diagnóstico da integração. Configure o webhook no painel Meta, valide GET/POST e sincronize modelos. Faça a homologação oficial separada antes de ativar qualquer registro antigo.
8. Para persistência no boot, confira a configuração PM2 já existente. `pm2 save` grava a lista de processos do usuário inteiro: execute somente após conferir que preserva os demais sites/processos. A implementação não instalou nem alterou serviços da VPS.

Rollback não é copiar um banco antigo por cima de um backend ativo. Pare o processo, faça outro backup e reconcilie possíveis envios posteriores ao snapshot. `npm run restore -- /caminho/backup.sqlite` suspende trabalhos e conserva resultados incertos; retomar não é automático.

## Validação e pendências

Os testes locais usam SQLite real, HTTP local, processos Node e transporte/Meta sintéticos. A tabela financeira é controlada e fictícia. O navegador usa Edge headless contra fixture isolada, sem `.env` operacional. Resultados finais e capturas ficam em [VALIDACAO_CLOUD_API.md](VALIDACAO_CLOUD_API.md).

Não foram usados recursos oficiais de teste nem operação real. Permanecem externos: domínio/TLS, identificadores corretos, token e escopos efetivos, subscrição, conectividade da Meta, modelos aprovados reais, limites/qualidade da conta, mídia real e tabela de preços aplicável à conta.

A consulta ao [portal Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/) e às referências técnicas/changelog retornou HTTP 429 nesta sessão. Política e preços públicos e a [coleção oficial Meta no Postman](https://www.postman.com/meta/whatsapp-business-platform/overview) estavam acessíveis. Endpoints básicos, permissões e formato geral de recibos foram conferidos ali; exemplos antigos de cobrança por conversa na coleção não foram usados como tarifas atuais. Confirmar antes da homologação: versão Graph vigente, nomes/disponibilidade dos webhooks opcionais de conta/modelo, campos atuais de cobrança, formatos especiais de modelos e retorno de correlação na versão escolhida. Nenhum desses pontos é declarado validado em uma conta real.
