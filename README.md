# rules

An end-to-end business rules platform showcase:

- **Author** rules visually with the GoRules JDM editor, or **generate** them with an LLM
  (Anthropic, OpenAI/Azure, OpenAI-compatible, or a mock), always as a reviewable draft.
- **Version** every save immutably in Postgres. Run many versions side by side, pin a
  version or use aliases (`default`, `stable`, `beta`), deprecate with a sunset, disable,
  and roll back instantly by moving an alias.
- **Evaluate** with the GoRules ZEN engine behind a REST microservice. Every response says
  which version ran.
- **Govern** with per-application RBAC, an activation gate driven by stored test cases, and
  a full audit log.
- **Render** the UI as micro-frontends whose screens are server-driven json-render specs,
  validated with Zod on the BFF and in the browser.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the scripted [docs/DEMO.md](docs/DEMO.md),
and the decision log [docs/DECISIONS.md](docs/DECISIONS.md).

## Quickstart (Docker)

Requirements: Docker, Node 22 with pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm stack:up       # postgres, rules-service, bff, shell, three remotes (docker compose)
```

Open **http://localhost:5173** and pick a demo user:

| User | Access |
|---|---|
| alice | global admin |
| bob | edit + publish on `loan-origination` |
| carol | edit on `loan-origination` |
| dave | view only |
| svc-loan | service account (evaluate only) |

`pnpm stack:reseed` restores the demo data and `pnpm stack:down` removes everything.

## Development (hot reload)

Also requires Python 3.12 with [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env
pnpm install
pnpm db:up          # only Postgres in docker
pnpm dev            # migrates + seeds, then shell :5173, remotes :5174-5176, bff :8787, rules-service :8000
```

Each remote also runs standalone on its own port with a mock session
(`http://localhost:5174/rules`, `:5175/releases`, `:5176/admin`). The rules-service API docs
are at http://localhost:8000/docs.

To use a personal Neon branch instead of docker Postgres, set `DATABASE_URL` (pooled) and
`DATABASE_URL_UNPOOLED` (direct) in `.env`, then run `pnpm db:migrate`.

## Tests

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit tests: vitest + pytest (needs Postgres: pnpm db:up)
pnpm e2e:compose                           # Playwright against docker compose (demo path + MFE isolation)
cd apps/api/rules-service && uv run pytest -m live   # optional: real Anthropic call (needs ANTHROPIC_API_KEY, AI_DEFAULT_MODEL)
```

## Layout

```
apps/web/{shell,mfe-rules,mfe-releases,mfe-admin}   Vite + React 19 + Module Federation
apps/api/bff                                        Hono BFF (server-driven UI specs)
apps/api/rules-service                              FastAPI + zen-engine + Postgres (+ AI authoring)
packages/{schemas,ui-registry,sdui-runtime,auth,api-client,config}
e2e/                                                Playwright
infra/                                              docker compose, Vercel setup
docs/                                               ARCHITECTURE, DECISIONS, DEMO
```
