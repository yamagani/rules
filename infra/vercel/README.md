# Deploying to Vercel + Neon

Six Vercel projects point at this monorepo, each with its own Root Directory. Neon provides
Postgres: one branch per pull request, plus `main` for production. GitHub Actions
(`.github/workflows/deploy.yml`) drives everything, so migrations always run **before** a
deployment and never at function cold start.

| Vercel project | Root directory | Runtime | Build |
|---|---|---|---|
| `rules-shell` | `apps/web/shell` | static + 1 edge function (`/bff/*` proxy) | Build Output API (`pnpm run build:vercel`) |
| `rules-mfe-rules` | `apps/web/mfe-rules` | static (`remoteEntry.js`) | Vite |
| `rules-mfe-releases` | `apps/web/mfe-releases` | static | Vite |
| `rules-mfe-admin` | `apps/web/mfe-admin` | static | Vite |
| `rules-bff` | `apps/api/bff` | Node.js function (Hono), bundled with esbuild | Build Output API |
| `rules-service` | `apps/api/rules-service` | Python function (FastAPI ASGI, `api/index.py`) | `requirements.txt` |

Every app commits its own `vercel.json`, with `npx turbo-ignore` as the Ignored Build Step
when Git-triggered builds are used.

## 1. Create the projects

```bash
export VERCEL_TOKEN=…            # https://vercel.com/account/tokens
export VERCEL_TEAM_ID=team_…     # if the projects live in a team
bash infra/vercel/setup.sh       # creates/links the six projects, sets Root Directories, prints project ids
```

`setup.sh` enables "Include source files outside of the Root Directory": the apps import
workspace packages from `packages/*`.

**Deployment Protection:** keep Vercel Authentication on for `rules-shell`, `rules-bff` and
`rules-service`. Enable **Protection Bypass for Automation** on those three and store the
secret as `VERCEL_AUTOMATION_BYPASS_SECRET`: the shell → BFF → rules-service calls are
server-to-server and send it as `x-vercel-protection-bypass`. Turn protection **off** for the
three `rules-mfe-*` projects. They serve public static JavaScript that the shell loads
cross-origin, and a protected remote cannot be loaded as a module from the shell's origin.

## 2. Neon

1. Create a Neon project and keep its default branch `main` for production.
2. Choose **one** way to get a branch per pull request:
   - **GitHub Actions (default, already wired):** `deploy.yml` creates `preview/pr-<n>` from
     `main` (or reuses it), migrates and seeds it, passes its pooled and direct URLs to the
     preview deployments, and deletes it when the PR closes.
   - **Neon–Vercel integration:** install it on `rules-service` only, with "create a branch
     for each preview deployment" enabled. It injects `DATABASE_URL` (pooled) and
     `DATABASE_URL_UNPOOLED` into previews. Then delete the `--env DATABASE_URL*` flags in
     `deploy.yml` and keep its migration step.
3. Connection strings:
   - `DATABASE_URL`: the **pooled** string (`-pooler` host). The service uses `NullPool`
     with psycopg 3 and no server-side prepared statements, which is safe behind PgBouncer.
   - `DATABASE_URL_UNPOOLED`: the **direct** string, used only by Alembic.

## 3. GitHub configuration

Repository **secrets** (referenced only as `${{ secrets.NAME }}`):

| Secret | Used for |
|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID` | Vercel CLI deploys |
| `VERCEL_PROJECT_ID_SHELL`, `…_MFE_RULES`, `…_MFE_RELEASES`, `…_MFE_ADMIN`, `…_BFF`, `…_RULES_SERVICE` | Selecting each project (printed by `setup.sh`) |
| `NEON_API_KEY`, `NEON_PROJECT_ID` | Branch lifecycle and production migrations |
| `DEMO_JWT_SECRET` | Signing demo tokens on preview deployments (random, ≥ 32 chars) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Server-to-server calls and Playwright against protected previews |

Repository **variables** (optional): `PROD_URL_MFE_RULES`, `PROD_URL_MFE_RELEASES`,
`PROD_URL_MFE_ADMIN` (production remote URLs that unchanged remotes fall back to on
previews) and `PROD_URL_RULES_SERVICE` (production smoke check).

Recommended: protect `main` and require the `CI` checks (`lint · typecheck · unit tests
(JS)`, `rules-service (ruff · mypy · pytest)`, `e2e (docker compose + Playwright)`) and
`Deploy / preview`.

## 4. Environment variables per project

Set **Production** values in each Vercel project's settings. Preview values are passed per
deployment by `deploy.yml` (`--env` / `--build-env`), so there is nothing to configure for
Preview.

| Project | Variable | Preview (set by deploy.yml) | Demo deployment | Production |
|---|---|---|---|---|
| rules-service | `ENV` | `preview` | `demo` | `production` |
| | `DATABASE_URL` | PR branch, pooled | `demo` branch, pooled | `main`, pooled |
| | `DATABASE_URL_UNPOOLED` | PR branch, direct | `demo` branch, direct | `main`, direct |
| | `DEMO_AUTH` | `true` | `true` | *unset* (refuses to start if `true`) |
| | `RULES_DEPLOYMENT` | — | `demo` | *unset* |
| | `DEV_JWT_SECRET` | `DEMO_JWT_SECRET` | random | *unset* |
| | `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `OIDC_ROLES_CLAIM`, `OIDC_GROUPS_CLAIM` | — | optional | **required** |
| | `AI_DEFAULT_PROVIDER` | `mock` | `mock` (or `anthropic`) | `anthropic` (example) |
| | `AI_DEFAULT_MODEL` | — | e.g. `claude-sonnet-5-5` | e.g. `claude-sonnet-5-5` |
| | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | — | optional | as needed (**only here**) |
| | `AI_MAX_REPAIR_ATTEMPTS`, `AI_RATE_LIMIT_*`, `AI_MAX_*` | defaults | defaults | as needed |
| rules-bff | `RULES_SERVICE_URL` | rules-service preview URL | demo rules-service URL | production rules-service URL |
| | `RULES_SERVICE_BYPASS_SECRET` | bypass secret | if protected | if protected |
| | `DEFAULT_APP` | `loan-origination` | `loan-origination` | your app key |
| rules-shell | `BFF_URL` (runtime, edge proxy) | BFF preview URL | demo BFF URL | production BFF URL |
| | `BFF_BYPASS_SECRET` | bypass secret | if protected | if protected |
| | `VITE_REMOTE_RULES_URL`, `VITE_REMOTE_RELEASES_URL`, `VITE_REMOTE_ADMIN_URL` (build) | preview remote URLs, or production when unchanged | demo remote URLs | production remote URLs |
| rules-mfe-* | — | — | — | — |

LLM API keys exist **only** on `rules-service`. The shell, remotes and BFF never receive
them, and CI greps every built static asset for secret-shaped values and for the canary
values injected during the build (`scripts/check-client-bundles.sh`).

## 5. The demo environment

Create a second set of projects (or Vercel "environments" on Pro), with production
deployments and a custom domain such as `rules-demo.example.com`:
- Neon branch `demo`, seeded once:
  `ENV=demo DATABASE_URL=<demo direct> uv run python -m app.seed`
- `ENV=demo`, `DEMO_AUTH=true`, `RULES_DEPLOYMENT=demo`, `DEV_JWT_SECRET`, `AI_DEFAULT_PROVIDER=mock`
- Optionally `ANTHROPIC_API_KEY`: then, as alice, enable the Anthropic provider.

`RULES_DEPLOYMENT=demo` is what allows demo login on a deployment whose `VERCEL_ENV` is
`production`. The real production project must never set it (see `docs/DECISIONS.md` D-104).

## 6. Single origin for the browser

The browser only talks to the shell's domain. `/bff/*` is served by the shell's edge
function (`apps/web/shell/scripts/bff-proxy.js`), which forwards to `BFF_URL`. That avoids
CORS and keeps the session cookie first-party. A plain `vercel.json` rewrite cannot be used,
because rewrites cannot read environment variables, and each preview shell must reach its
own preview BFF. Remotes load from the runtime `/mfe-manifest.json`, which is generated at
build time from `VITE_REMOTE_*_URL`.

Cache headers:
- Hashed `/assets/*`: `public, max-age=31536000, immutable`.
- `remoteEntry.js`, `mf-manifest.json`, `mfe-manifest.json` and HTML: `no-cache`.

## 7. Local development against a personal Neon branch

```bash
neonctl branches create --name dev/$USER --project-id <id>
# .env
DATABASE_URL=<pooled connection string>
DATABASE_URL_UNPOOLED=<direct connection string>
pnpm db:migrate && pnpm --filter @rules/rules-service seed && pnpm dev
```
