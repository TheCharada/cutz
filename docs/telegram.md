# Telegram — vinculação e notificações

O Cutz usa **um bot único** para enviar notificações de agendamentos e lista de espera. A associação ao Telegram é opcional. O cliente pode vincular apenas um agendamento ou uma entrada na lista de espera; ao compartilhar **seu próprio contato pelo Telegram** e confirmar o número cadastrado, ativa também os avisos dos próximos agendamentos e listas daquele estabelecimento. A confirmação do Telegram não substitui a verificação de telefone por WhatsApp OTP usada para autenticação no site.

A aplicação continua agnóstica de provedor de hospedagem. O webhook HTTPS deve ser acessível publicamente, e o worker precisa alcançar a Telegram Bot API.

## 1. Criar um bot

1. No Telegram, abra o bot oficial `@BotFather` e use `/newbot`.
2. Defina um nome e um username terminado em `bot` (por exemplo, `CutzExampleBot`).
3. Guarde o token recebido em um gerenciador de segredos. **Não o coloque no repositório, em logs nem em mensagens de suporte.**
4. Gere um segredo independente para autenticar os webhooks:

```bash
openssl rand -hex 32
```

Não confunda `TELEGRAM_BOT_TOKEN` (credencial de envio) com `TELEGRAM_WEBHOOK_SECRET` (validação de chamadas recebidas).

## 2. Configurar a aplicação

Com um arquivo `.env.production` privado (permissão `600`), configure:

```dotenv
APP_ORIGIN=https://app.example.org
MESSAGING_PROVIDER=telegram
TELEGRAM_BOT_USERNAME=CutzExampleBot
TELEGRAM_BOT_TOKEN=<token-do-bot>
TELEGRAM_WEBHOOK_SECRET=<segredo-aleatorio-do-webhook>
```

Use o domínio HTTPS real em `APP_ORIGIN`, sem uma porta interna de container. Os valores de exemplo acima não são credenciais.

- `TELEGRAM_BOT_USERNAME` e `TELEGRAM_WEBHOOK_SECRET` são enviados **somente** à web. Sem ambos, o botão opcional de vinculação fica oculto e o webhook retorna 503.
- `TELEGRAM_BOT_TOKEN` é enviado **somente** ao worker, necessário quando `MESSAGING_PROVIDER=telegram`.
- O modo `fake` permanece o padrão; o WhatsApp continua disponível independentemente.
- Não execute `db:seed` em produção nem repita o bootstrap durante atualizações.

Antes de substituir a imagem, faça backup verificável do PostgreSQL. Baixe a nova imagem multiarch e aplique as migrations **antes** de recriar web e worker:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml pull migrate web worker
docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate migrate
docker compose --env-file .env.production -f docker-compose.production.yml wait migrate
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps --force-recreate web worker
```

Só prossiga se o container `migrate` tiver saído com código `0`. A implantação com `MESSAGING_PROVIDER=telegram` exige que o webhook também esteja registrado; até lá, mantenha o modo `fake`.

## 3. Registrar o webhook HTTPS

Depois que a nova web estiver no ar e a rota HTTPS puder ser alcançada, registre **um único webhook** para esse bot. Use o token/segredo do seu ambiente local, sem imprimi-los em comandos de diagnóstico, históricos compartilhados ou URLs de tickets.

Exemplo com variáveis temporárias no shell (não copie segredos literalmente):

```bash
set +o history
read -r -s -p "Token do bot: " BOT_TOKEN; echo
read -r -s -p "Segredo do webhook: " WEBHOOK_SECRET; echo
curl --fail --silent --show-error \
  --request POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://app.example.org/api/webhooks/telegram" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]'
unset BOT_TOKEN WEBHOOK_SECRET
```

**Atenção:** URLs com o token do bot podem aparecer em histórico de proxy/diagnóstico. Execute o comando em sessão privada e não registre a URL completa. Também é possível configurar o webhook usando um gerenciador de segredos e um cliente HTTP automatizado que não exponha o token.

O endpoint verifica `X-Telegram-Bot-Api-Secret-Token` em tempo constante, limita o tamanho do JSON e aceita apenas comandos de chat privado:

- `/start <token>`: consome o token uma única vez, confirma os detalhes do registro e oferece um botão opcional para compartilhar o próprio número.
- Contato enviado pelo botão: só ativa a assinatura do cliente se o contato pertencer à mesma conta Telegram e o telefone coincidir com o cadastro daquele estabelecimento.
- `/stop`: revoga os vínculos desse chat, incluindo as assinaturas persistentes.
- Outros comandos: ignorados.

Para conferir o webhook, consulte `getWebhookInfo` usando um cliente protegido. Verifique `url`, `pending_update_count` e eventuais `last_error_message`. Um `401` no webhook indica segredo divergente; `503` indica webhook não configurado.

## 4. Fluxo do cliente

1. O cliente cria um agendamento ou entra na lista de espera normalmente.
2. Se o Telegram estiver configurado, aparece o botão **Conectar Telegram** na confirmação e na página de gerenciamento.
3. O botão emite um link `https://t.me/<bot>?start=<token>`. O token expira após dez minutos e só pode ser usado uma vez.
4. O cliente abre o bot, toca **Iniciar** e recebe um resumo do agendamento ou da lista de espera imediatamente, mesmo se o job de confirmação já tiver sido processado.
5. Para receber automaticamente os próximos avisos daquele estabelecimento, toca **Compartilhar meu telefone**. O bot compara o contato da própria conta com o telefone cadastrado; se não corresponder, o vínculo continua restrito ao recurso original.
6. Após a verificação, **novos agendamentos, reagendamentos, lembretes e listas de espera do mesmo cliente e estabelecimento** passam a usar esse chat. Jobs antigos não são reenviados.
7. O cliente pode enviar `/stop` para desativar os avisos daquele chat.

Uma vinculação por agendamento **sem confirmação do contato** não concede acesso a outras reservas do mesmo telefone. A assinatura persistente exige que o Telegram forneça o contato da própria conta e que o número coincida com o cadastro. Uma assinatura confirmada é específica por cliente e estabelecimento; ao reagendar não é preciso vincular novamente. Compartilhar um contato de outra pessoa ou apenas digitar um número não autoriza a assinatura.

## 5. Verificar sem expor dados

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 web worker
curl --fail --show-error https://app.example.org/api/health
```

Faça um agendamento de teste, vincule um chat e confira mensagens de lembrete futuras. Teste também a fila de espera e o comando `/stop`.

O `sendMessage` marca aceitação pela API do Telegram, **não confirma leitura ou entrega ao destinatário**. Erros 429 respeitam `retry_after`; erros 403 revogam o chat; jobs sem chat vinculado são cancelados, sem retentativas ilimitadas.

Não inclua `/start` tokens, URLs de gerenciamento, `chat_id`, códigos OTP ou credenciais ao compartilhar logs. Um retorno 200 do webhook não deve ser interpretado como prova de que uma mensagem posterior foi entregue.
