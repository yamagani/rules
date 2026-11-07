# Deploying to Vercel + Neon

Three Vercel projects, all connected to this GitHub repository. Neon is connected to the API
through the **Neon–Vercel integration**.

| Vercel project | Root directory | What it serves |
|---|---|---|
| `rules-web` (any name, e.g. `rules`) | `apps/web/shell` | The shell **and** the three micro-frontends (served same-origin under `/_mfe/<name>/`), plus an edge function proxying `/bff/*` to the BFF |
| `rules-bff` | `apps/api/bff` | Hono BFF as one Node.js function |
| `rules-api` | `apps/api/rules-service` | FastAPI + ZEN engine (Python function). Runs database migrations during its build |

```
browser ──▶ rules-web ──/bff/*──▶ rules-bff ──▶ rules-api ──▶ Neon (DATABASE_URL from the integration)
```

How the pieces find each other: `rules-web` and `rules-bff` list their downstream project in
`relatedProjects` (`vercel.json`), so Vercel tells each deployment where the next one is. A
preview of branch `feature-x` talks to the `feature-x` previews of the BFF and API;
production talks to production. There are no URLs to configure.

Pushes deploy automatically: every PR gets preview URLs, and every merge to `main` deploys
production. Each project rebuilds only when its own code or its workspace packages changed
(`npx turbo-ignore`).

## One-time setup (≈ 15 minutes)

### 1. Create the projects
Install the Vercel GitHub app on the repository, then on your machine (needs Node and jq):

```bash
export VERCEL_TOKEN=…          # https://vercel.com/account/tokens
export VERCEL_TEAM_ID=team_…   # only if the projects live in a team
bash infra/vercel/setup.sh     # creates rules-web, rules-bff, rules-api and writes relatedProjects ids
git add apps/web/shell/vercel.json apps/api/bff/vercel.json
git commit -m "chore(vercel): link related projects"
git push
```

### 2. Connect Neon to `rules-api`
Vercel dashboard → **Integrations → Neon** (Marketplace) → create or link a Neon project and
connect it **only to `rules-api`**. In the integration settings, enable:
- **Create a database branch for each preview deployment.** Each PR gets its own Neon branch,
  created from `main`.
- **Delete obsolete branches** (or delete them in Neon) when PRs close.

The integration injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) into
every deployment. During the build, `rules-api` runs `alembic upgrade head` on the direct
URL (`scripts/vercel_build.py`), so the schema is ready before the deployment goes live, and
seeds preview branches with the demo data. Production is never seeded.

### 3. Environment variables (only `rules-api`)

| Variable | Preview | Production |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | set by the Neon integration | set by the Neon integration |
| `DEMO_AUTH` | `true` | *unset* |
| `DEV_JWT_SECRET` | random, ≥ 32 characters | *unset* |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` (+ optional `OIDC_ROLES_CLAIM`, `OIDC_GROUPS_CLAIM`) | — | **required** |
| `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL` | `mock` | e.g. `anthropic` / `claude-sonnet-5-5` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | optional | as needed |

`ENV` follows `VERCEL_ENV` automatically (preview / production). `rules-web` and `rules-bff`
need no variables.

**Want demo users on the production URL** (no identity provider yet)? On `rules-api`
Production, set `ENV=demo`, `DEMO_AUTH=true`, `RULES_DEPLOYMENT=demo` and `DEV_JWT_SECRET`.
The build then also seeds the demo data. Also set the GitHub repository variable
`PRODUCTION_IS_DEMO=true`, so the production guard in `deploy.yml` doesn't flag it. Remove
all of these once OIDC is configured.

### 4. Deployment Protection
Simplest setting: protect **`rules-web` previews only** (the default Vercel Authentication),
and turn protection off for `rules-bff` and `rules-api`. They authenticate every request
themselves (session cookie / JWT), and preview databases hold demo data only.

If you do protect them, enable *Protection Bypass for Automation* on each and set:
- on `rules-web`: `BFF_BYPASS_SECRET` = the BFF's bypass secret;
- on `rules-bff`: `RULES_SERVICE_BYPASS_SECRET` = the API's bypass secret.

### 5. Optional: Playwright on previews
`deploy.yml` runs the Playwright smoke suite whenever a `rules-web` preview is ready. If
`rules-web` previews are protected, add the repository secret
`VERCEL_AUTOMATION_BYPASS_SECRET` (the web project's bypass secret). The full demo path
runs in CI against docker compose on every PR.

## What runs where

| Event | What happens |
|---|---|
| Push to a PR | Changed projects build previews. `rules-api` gets a Neon branch, migrates and seeds it. The PR shows the preview links. `deploy.yml` runs Playwright against the web preview |
| PR closed | The Neon integration deletes the branch (if enabled) |
| Merge to `main` | Changed projects deploy to production. `rules-api` migrates Neon `main` during its build. `deploy.yml` checks that production rejects demo login and unauthenticated calls |

## Troubleshooting
- **`rules-api` build fails with "No database URL":** the Neon integration isn't connected
  to `rules-api`, or not for that environment.
- **Web loads but every screen says the BFF is unreachable:** the `relatedProjects` ids
  weren't committed (rerun `setup.sh`), or the BFF/API are protected without bypass
  secrets (step 4).
- **Production API returns 500 at startup:** OIDC variables are missing. This is
  intentional: production refuses to run without real authentication or the explicit demo
  settings above.
- **Local development against Neon:** set `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in `.env`
  to a personal branch, then run `pnpm db:migrate && pnpm dev`.
