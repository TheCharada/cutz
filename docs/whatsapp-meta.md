# WhatsApp / Meta Cloud API

Este documento define o contrato entre os `NotificationJob` do Cutz, os templates aprovados no WhatsApp Business Platform e os callbacks assíncronos de status da Meta.

## Configuração do worker

Com `MESSAGING_PROVIDER=whatsapp`, o worker exige:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_TEMPLATE_LANGUAGE`
- os sete nomes de template `WHATSAPP_TEMPLATE_*`

O `APP_ORIGIN` também faz parte do contrato. URLs de capability enviadas pelo domínio são aceitas somente quando pertencem ao mesmo origin configurado no worker.

O access token, Phone Number ID e nomes de templates pertencem ao **worker**. O App Secret usado para validar callbacks pertence ao **web** e não precisa ser exposto ao worker.

## Templates utility

Os parâmetros abaixo são posicionais e precisam corresponder exatamente ao template aprovado na Meta.

### APPOINTMENT_CREATED

Body sugerido:

```text
Olá, {{1}}. Seu agendamento de {{2}} com {{3}} foi criado para {{4}}.
```

Parâmetros:

1. nome do cliente
2. serviço
3. profissional
4. instante do agendamento

Adicionar um botão de website dinâmico no índice 0, por exemplo `Gerenciar agendamento`, com URL:

```text
https://SEU-APP-ORIGIN/{{1}}
```

O worker envia somente o sufixo dinâmico da URL, nunca a capability URL completa como parâmetro do body.

### APPOINTMENT_RESCHEDULED

Body sugerido:

```text
Olá, {{1}}. Seu agendamento de {{2}} com {{3}} foi reagendado para {{4}}.
```

Parâmetros:

1. nome do cliente
2. serviço
3. profissional
4. novo instante

Adicionar um botão de website dinâmico no índice 0 com a mesma base de `APP_ORIGIN`.

### APPOINTMENT_REMINDER

Body sugerido:

```text
Olá, {{1}}. Lembrete: seu atendimento de {{2}} com {{3}} está marcado para {{4}}.
```

Parâmetros:

1. nome do cliente
2. serviço
3. profissional
4. instante do agendamento

Não possui botão dinâmico.

### APPOINTMENT_CANCELLED

Body sugerido:

```text
Olá, {{1}}. Seu atendimento de {{2}} com {{3}}, marcado para {{4}}, foi cancelado. Motivo: {{5}}.
```

Parâmetros:

1. nome do cliente
2. serviço
3. profissional
4. instante do agendamento
5. motivo, ou `Não informado`

Não possui botão dinâmico.

### WAITLIST_ENTRY_CREATED

Body sugerido:

```text
Olá, {{1}}. Você entrou na lista de espera para {{2}} em {{3}}, entre {{4}} e {{5}}.
```

Parâmetros:

1. nome do cliente
2. serviço
3. data desejada
4. início da janela
5. fim da janela

Adicionar um botão de website dinâmico no índice 0, por exemplo `Gerenciar fila`, com URL baseada em `APP_ORIGIN`.

### WAITLIST_OFFER

Body sugerido:

```text
Olá, {{1}}. Surgiu uma vaga para {{2}} com {{3}}, de {{4}} a {{5}}. Responda até {{6}}.
```

Parâmetros:

1. nome do cliente
2. serviço
3. profissional
4. início da vaga
5. fim da vaga
6. expiração da oferta

Adicionar um botão de website dinâmico no índice 0, por exemplo `Responder oferta`, com URL baseada em `APP_ORIGIN`.

## Template de autenticação / OTP

`CUSTOMER_OTP` deve usar a categoria **AUTHENTICATION**, com botão OTP do tipo **COPY_CODE** e expiração de 10 minutos.

Ao enviar, o worker fornece o código duas vezes conforme o contrato desse tipo de template:

1. parâmetro do body: código OTP
2. parâmetro do botão URL/copy-code no índice 0: o mesmo código OTP

O texto do template de autenticação é controlado pela Meta; não deve ser modelado como uma mensagem utility livre.

## Domínio dos botões

O prefixo configurado nos templates com CTA dinâmica precisa corresponder ao `APP_ORIGIN` de produção. Por exemplo, para uma aplicação hospedada em `https://cutz.example.org`, o origin é:

```text
https://cutz.example.org
```

Nesse caso, a URL dinâmica dos templates deve usar:

```text
https://cutz.example.org/{{1}}
```

Ao alterar `APP_ORIGIN`, atualize também os templates aprovados que tenham URL dinâmica.

## Webhooks de status

A aceitação do `POST /messages` e a entrega ao aparelho são estados diferentes. Quando a Meta aceita o envio, o worker persiste:

```text
NotificationJob.status = SENT
provider_message_id = wamid...
delivery_status = ACCEPTED
```

`NotificationJob.status = SENT` significa somente que o provider aceitou a requisição e forneceu um identificador. O lifecycle assíncrono é mantido separadamente em `delivery_status`:

```text
ACCEPTED
SENT
DELIVERED
READ
FAILED
DELETED
```

Os callbacks são correlacionados por `provider_message_id`. O timestamp do evento recebido da Meta determina a ordem; callbacks duplicados ou mais antigos não fazem o estado regredir. Para eventos com o mesmo timestamp, o Cutz usa uma precedência determinística para tornar o processamento idempotente.

Uma falha assíncrona não altera `NotificationJob.status` para `FAILED` nem reabre automaticamente o job para retry. Nesse momento a Meta já aceitou a requisição original e a causa pode ser permanente, como restrição de conta, política, destino ou país. O callback registra separadamente:

- `delivery_status = FAILED`;
- `delivery_status_at`;
- `delivery_error_code`, quando fornecido;
- `delivery_error_message`, quando fornecido.

Falhas assíncronas são registradas para diagnóstico, sem produzir um novo envio automático.

### Endpoint

O endpoint de callbacks, no exemplo de origin acima, é:

```text
https://cutz.example.org/api/webhooks/meta/whatsapp
```

O endpoint implementa dois contratos:

- `GET`: handshake de configuração do webhook, validando `hub.mode`, `hub.verify_token` e retornando `hub.challenge`;
- `POST`: callback de status, validando `X-Hub-Signature-256` sobre o corpo bruto antes de interpretar ou persistir o payload.

No painel da Meta, a assinatura deve incluir o campo de mensagens/status correspondente à conta WhatsApp Business usada pelo Cutz.

### Variáveis do web

O serviço `web` precisa receber:

```text
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<valor aleatório escolhido pelo Cutz>
WHATSAPP_APP_SECRET=<App Secret da aplicação Meta>
```

O `WHATSAPP_WEBHOOK_VERIFY_TOKEN` deve ter o mesmo valor informado durante a configuração do callback na Meta. O `WHATSAPP_APP_SECRET` é o segredo da aplicação Meta usado para validar a assinatura HMAC dos callbacks.

Esses valores são segredos de deployment. Não devem ser commitados, exibidos em logs nem colocados neste documento.

### Respostas e idempotência

Callbacks com assinatura inválida são rejeitados antes de tocar o banco. Eventos válidos são processados de forma idempotente:

- evento mais novo: atualiza o delivery status;
- evento duplicado/mais antigo: é ignorado;
- `provider_message_id` desconhecido: é contabilizado como `unmatched` e reconhecido sem criar um `NotificationJob` artificial.

A resposta do endpoint expõe somente contagens operacionais (`received`, `updated`, `ignored`, `unmatched`), sem payload sensível.

## Smoke direto da Cloud API

Para validar o provider real, confira token, Phone Number ID, destinatário e um template aprovado diretamente na Graph API.

Defina localmente, sem commitar:

```bash
export WHATSAPP_ACCESS_TOKEN='...'
export WHATSAPP_PHONE_NUMBER_ID='...'
export WHATSAPP_GRAPH_API_VERSION='vXX.X'
export WHATSAPP_SMOKE_TO='+55...'
export WHATSAPP_SMOKE_TEMPLATE='...'
export WHATSAPP_SMOKE_TEMPLATE_LANGUAGE='pt_BR'
```

Para um template aprovado **sem parâmetros**:

```bash
TO="${WHATSAPP_SMOKE_TO#+}"
curl --fail-with-body -sS \
  -X POST \
  "https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data "$(printf '{\"messaging_product\":\"whatsapp\",\"recipient_type\":\"individual\",\"to\":\"%s\",\"type\":\"template\",\"template\":{\"name\":\"%s\",\"language\":{\"code\":\"%s\"}}}' \
    "$TO" "$WHATSAPP_SMOKE_TEMPLATE" "$WHATSAPP_SMOKE_TEMPLATE_LANGUAGE")"
```

Sucesso de aceitação pela Cloud API deve retornar `messages[0].id` (`wamid...`). Isso comprova a aceitação da requisição, não a entrega no aparelho.

Depois desse smoke direto, configure os sete templates no worker, altere `MESSAGING_PROVIDER=whatsapp` e faça um fluxo real do Cutz que gere `NotificationJob`. A validação end-to-end é considerada bem-sucedida quando:

1. o job é criado no PostgreSQL;
2. o worker o processa;
3. a Meta retorna `providerMessageId`;
4. o job fica `SENT` e o delivery lifecycle inicia em `ACCEPTED`;
5. o webhook recebe `SENT`/`DELIVERED` (e eventualmente `READ`);
6. a mensagem chega ao número de teste.

Se o callback terminar em `FAILED`, o erro assíncrono deve ser diagnosticado antes de habilitar o provider para uso normal.