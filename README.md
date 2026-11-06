# rules

End-to-end showcase of a business rules platform: visual rule authoring (GoRules JDM editor),
immutable versioning with aliases, publish/rollback, per-application RBAC, AI-assisted rule
generation, and rule evaluation with the GoRules ZEN engine — rendered as server-driven
micro-frontends.

## Quickstart

Requirements: Node 22 (`corepack enable`), pnpm 10, Python 3.12 with [uv](https://docs.astral.sh/uv/), Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up        # Postgres in docker
pnpm dev          # shell :5173, remotes :5174-5176, bff :8787, rules-service :8000
```

Open http://localhost:5173. Each remote also runs standalone on its own port.

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Full containerised stack: `docker compose -f infra/docker-compose.yml up --build`.

## Layout

```
apps/web/{shell,mfe-rules,mfe-releases,mfe-admin}   Vite + React + Module Federation
apps/api/bff                                        Hono BFF (server-driven UI specs)
apps/api/rules-service                              FastAPI + zen-engine + Postgres
packages/{schemas,ui-registry,sdui-runtime,auth,api-client,config}
infra/                                              docker-compose, Vercel setup
docs/                                               ARCHITECTURE, DECISIONS, DEMO
```

See [docs/DECISIONS.md](docs/DECISIONS.md) for design decisions and deviations.
