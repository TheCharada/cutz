# Implantação independente de provedor

O Cutz pode ser executado em uma VM Linux com Docker e Docker Compose. A arquitetura mantém **três serviços**: PostgreSQL, web (Next.js e API) e worker de jobs.

O Compose de produção usa `MESSAGING_PROVIDER=fake` por padrão, sem dependência de um provedor específico de nuvem.

## Pré-requisitos

- VM com Docker Engine e Docker Compose Plugin.
- Um endereço público e HTTPS para a aplicação (por exemplo, Caddy/Nginx como proxy reverso).
- Persistência do volume do PostgreSQL.
- Variáveis de ambiente fora do Git, com senhas e secrets gerados para o novo ambiente.

O PostgreSQL **não** publica sua porta na rede do host. O serviço web é ligado a `127.0.0.1:3000` por padrão; configure o proxy reverso no mesmo host para expor apenas as portas 80/443.

## Construir imagem e configurar variáveis

```bash
docker build -t cutz:local .
cp .env.example .env.production
```

Edite o arquivo `.env.production` (ignorado pelo Git). Configure:

```dotenv
CUTZ_IMAGE=cutz:local
POSTGRES_DB=cutz
POSTGRES_USER=cutz
POSTGRES_PASSWORD=<senha-aleatoria-forte>
APP_ORIGIN=https://cutz.example.org
OTP_SECRET=<valor-aleatorio-com-pelo-menos-32-caracteres>
SEED_ADMIN_EMAIL=<email-administrativo>
SEED_ADMIN_PASSWORD=<senha-exclusiva>
MESSAGING_PROVIDER=fake
WEB_BIND_ADDRESS=127.0.0.1
WEB_PORT=3000
```

Esses campos são exemplos, **não** credenciais válidas ou valores a serem commitados. Para o banco, use uma senha compatível com interpolação de URL, ou faça o encoding correto de caracteres reservados antes de construir `DATABASE_URL`. O `APP_ORIGIN` deve coincidir com a origem HTTPS acessada pelos usuários.

## Iniciar o ambiente do zero

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres migrate

# Inicializa a barbearia de referência e o OWNER, sem fixtures E2E:
docker compose --env-file .env.production -f docker-compose.production.yml run --rm --no-deps web node dist/db/bootstrap.js

docker compose --env-file .env.production -f docker-compose.production.yml up -d web worker
```

O `migrate` executa `node dist/db/migrate.js` e termina; a web só inicia depois da migração. O bootstrap é **one-shot**, não faz parte de cada deploy. O worker processa jobs com leases e retries persistidos no PostgreSQL.

## HTTPS e rede

Provisione DNS + HTTPS antes de expor a demonstração. Um Caddy instalado no mesmo host pode encaminhar o domínio HTTPS para `127.0.0.1:3000`. Não exponha PostgreSQL nem endpoints de administração sem autenticação. Se mover a web para uma rede diferente do proxy, revise explicitamente `WEB_BIND_ADDRESS`, firewall e política de proxy/IP.

Por padrão, `RATE_LIMIT_TRUST_X_REAL_IP=false`. Só habilite confiança em headers quando o proxy controlar/sobrescrever esses campos de forma verificável.

## Validação

```bash
curl --fail --show-error https://cutz.example.org/api/health
curl --fail --show-error https://cutz.example.org/api/b/demo
```

Verifique a aplicação pública em `/b/demo`, o login em `/admin/login`, os fluxos de agendamento e a lista de espera. Para diagnósticos:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 web worker
```

## Mensageria

Com `MESSAGING_PROVIDER=fake`, nenhum envio externo é realizado. O provider Meta/WhatsApp continua opcional; seu contrato está em [whatsapp-meta.md](whatsapp-meta.md). Outros provedores de mensageria podem ser adicionados pela interface do domínio.

Os segredos da Meta não devem ficar no README, no código ou em logs. Uma troca de domínio exige atualizar `APP_ORIGIN` e os templates de URL dinâmica, caso WhatsApp venha a ser habilitado futuramente.

## Segurança e manutenção

- Gere credenciais exclusivas para a implantação. Não reutilize valores de exemplo do CI ou senhas de outros ambientes.
- Mantenha backups do volume PostgreSQL conforme o período de utilização da demonstração.
- Não confunda os fixtures de `pnpm db:seed` com o bootstrap sem clientes de teste.
- Atualizações devem aplicar migrations antes de iniciar a web e o worker.
