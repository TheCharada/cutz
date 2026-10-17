# Cutz

Aplicação web para gerenciamento de agendamentos de barbearias, com foco em disponibilidade, lista de espera e indicadores operacionais. O Cutz utiliza uma arquitetura multi-tenant, com isolamento de dados por estabelecimento.

## Funcionalidades

- Cadastro de serviços, profissionais e jornadas por barbearia.
- Agendamento público com prevenção de conflitos e disponibilidade calculada.
- Gestão administrativa de atendimentos, clientes e catálogo.
- Reagendamento, cancelamento, conclusão e registro de ausência.
- Lista de espera com ofertas de vagas, aceite, recusa e expiração.
- Indicadores de cancelamentos, ausências e lista de espera.
- Jobs persistidos no PostgreSQL e processados por worker separado.
- Interface responsiva com recursos de acessibilidade.
- Mensageria com provider local `fake` e integração opcional WhatsApp/Meta.

## Arquitetura

**Stack:** Next.js 16, React 19, TypeScript, PostgreSQL 17, Drizzle ORM, Tailwind CSS, Vitest, Playwright e Docker.

```text
Navegador
    |
    v
Next.js (web + API) -------> PostgreSQL
                                 ^
                                 |
                           Worker de jobs
                                 |
                          MessagingProvider
```

Os horários de atendimento são definidos no fuso IANA da barbearia. Instantes são armazenados em UTC e apresentados no fuso correspondente.

## Desenvolvimento local

Requisitos: Node.js 22, pnpm 11 e Docker Compose.

```bash
corepack enable
pnpm install
cp .env.example .env
```

Preencha `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` no `.env`. As demais configurações locais estão descritas em `.env.example`.

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Em outro terminal:

```bash
pnpm dev:worker
```

O frontend fica em `http://localhost:3000`. O seed local provisiona a **Barbearia Exemplo** (`/b/demo`) e o usuário administrativo definido no ambiente. A área administrativa fica em `/admin/login`.

No modo padrão, `MESSAGING_PROVIDER=fake`, o processamento de notificações é simulado, sem envios externos.

## Testes e verificações

```bash
pnpm lint
pnpm typecheck
pnpm arch
pnpm test
pnpm test:integration
pnpm build
pnpm build:worker
```

Os testes de integração e E2E exigem um PostgreSQL inicializado. O workflow de [CI](.github/workflows/ci.yml) executa os testes em ambiente isolado, incluindo Playwright e build da imagem de produção.

## Deploy

A aplicação possui [Dockerfile](Dockerfile) e [Docker Compose de produção](docker-compose.production.yml), incluindo PostgreSQL, migrations, web e worker. Os serviços podem ser hospedados em qualquer infraestrutura que execute containers Linux e ofereça HTTPS.

- [Instalação e operação](docs/deployment.md)
- [Integração WhatsApp / Meta Cloud API](docs/whatsapp-meta.md)

Credenciais devem ser configuradas por variáveis de ambiente, fora do controle de versão. O bootstrap de produção não cria fixtures de clientes ou agendamentos de testes.
