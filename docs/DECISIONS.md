# Decisions

Architecture decision log. Newest entries at the bottom of each section. Deviations from the
original build prompt are marked **Deviation**.

## Phase 0 — repository and tooling

### D-001 Starting state of the repository
`yamagani/rules` was empty when work began (no commits, no README, no `apps/` or `packages/`),
so nothing had to be preserved and nothing conflicts with the target layout.

### D-002 Bootstrap commit directly on `main` — **Deviation**
An empty repository has no default branch to open a pull request against. A single bootstrap
commit (README + `.gitignore`) was pushed to `main`; every later change goes through a
`phase-<n>-*` branch and a squash-merged PR. No force-push or history rewrite.

### D-003 Pull requests via the GitHub REST API — **Deviation (tooling only)**
In the Claude Code cloud session, `gh`'s GraphQL endpoint is blocked, so `gh pr create` /
`gh pr merge` do not work. PRs are created and squash-merged with `gh api` against the REST
endpoints (`POST /repos/{o}/{r}/pulls`, `PUT /repos/{o}/{r}/pulls/{n}/merge`), which is
functionally identical.

### D-004 Library versions
Resolved from npm/PyPI at the start of the work rather than assumed:

| Library | Version | Note |
|---|---|---|
| React | 19.x | `@json-render/react@0.22` requires `react ^19.2.3`, so React 19 (not 18). |
| Zod | 4.x | Peer of `@json-render/core@0.22`. |
| Vite | 8.x | Supported by `@module-federation/vite@1.23`. |
| `@module-federation/vite` | 1.23 | Remotes registered at runtime (see D-006). |
| `@gorules/jdm-editor` | 1.52 | Peer `react >= 18`. |
| Hono | 4.x | `@hono/node-server` 1.19 locally. |
| `zen-engine` (PyPI) | 2.1.3 | abi3 wheels: `manylinux_2_28` x86_64/aarch64, macOS, Windows. |
| Turborepo / pnpm | 2.11 / 10.28 | |

### D-005 Python tooling
`uv` manages `apps/api/rules-service` (`pyproject.toml` + `uv.lock`). Turbo invokes it through
`package.json` scripts (`dev`, `lint` = ruff, `typecheck` = mypy, `test` = pytest).
`requirements.txt` is exported from `uv.lock` for the Vercel Python runtime; CI fails if it
drifts from the lock file.

### D-006 Remotes are registered at runtime from `/mfe-manifest.json`
The shell's federation config declares **no static remotes**. On startup it fetches
`/mfe-manifest.json` (generated at build time from `VITE_REMOTE_*_URL`, served from memory in
dev) and calls `registerRemotes()` / `loadRemote()` from `@module-federation/runtime`. A remote
that fails to load is contained by a per-remote error boundary (verified with the admin remote
stopped: the other remotes and the shell keep working).

### D-007 Phase 0 spike: `zen-engine` on the Vercel Python runtime
**Status: verified locally on the target platform; live Vercel + Neon run pending secrets.**

- The Vercel Python runtime runs on Amazon Linux 2023 (glibc 2.34). `zen-engine` ships an
  abi3 `manylinux_2_28_x86_64` wheel, which is compatible with glibc ≥ 2.28.
- Verified in an `amazonlinux:2023` container with CPython 3.12 and the exact
  `requirements.txt`: the wheel installs, `api/index.py` imports, and `/spike/evaluate`
  returns the expected result.
  - Cold app import (FastAPI + SQLAlchemy + zen, first run, no bytecode cache): **~1.5 s**
  - First decision load + evaluate: **~1.3 ms**; warm evaluations are tens of µs.
- The live check is automated in `.github/workflows/spike-vercel.yml`: it creates a Neon
  branch, deploys `apps/api/rules-service` to Vercel, measures the cold and warm request,
  checks `/health/db` against Neon, and deletes the branch. It runs once the repository
  secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_RULES_SERVICE`, `NEON_API_KEY`
  and `NEON_PROJECT_ID` exist, and reports which are missing otherwise. Vercel and Neon APIs
  are not reachable from the build session itself, which is why the live run lives in CI.
- **Decision:** build rules-service for the Vercel Python runtime. The fallback (container on
  AWS App Runner or Fly.io against the same Neon database) stays available: the service also
  ships a `Dockerfile`, and nothing in the code depends on Vercel. If the live spike shows a
  cold start that is not acceptable (> ~3 s p50), switch the `rules-service` deployment to a
  container and record it here.

### D-008 Local Postgres
docker-compose Postgres 16 is the default for local runs (`pnpm db:up`). To use a personal
Neon branch instead, set `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) in
`.env`; see `infra/vercel/README.md` once Phase 6 lands.

## Phase 1 — rules-service core

### D-101 Content immutability is enforced by the database
`decision_versions.content`, `checksum`, `version` and `decision_id` are protected by a
`BEFORE UPDATE` trigger (migration `0001`) that raises `restrict_violation`. The API has no
update path either: every save inserts a new draft row. Only `status`, `sunset_at`,
`comment` and lifecycle timestamps can change.

### D-102 Evaluate version selection order — **Deviation (ordering)**
The prompt lists `?version`, `?alias`, the `default` alias, then `?draft=true`. Because every
activated decision has a `default` alias, `draft=true` would never be reached in that order.
Implemented order: `?version=n` → `?alias=name` → `?draft=true` → `default`. The response
always reports the resolved version (`X-Rule-Version`, `meta.version`) and how it was chosen
(`meta.resolved_by`).

### D-103 Permission implications
- `admin` implies all permissions; `edit` and `publish` each imply `view`.
- `evaluate` is independent: the `svc-loan` service account can evaluate but not read rule
  content, and `dave` (view) cannot evaluate.
- Editors may evaluate any version, including drafts, so they can test in the TestPanel.
  Drafts can be evaluated *only* by editors.
- Grants with `app_id = NULL` are global. Global grants use
  `UNIQUE NULLS NOT DISTINCT` (Postgres ≥ 15; Neon runs 16/17).
- `force=true` on activate/enable needs `admin`, on top of `publish`.

### D-104 Demo login guard — **Deviation (extra variable)**
The dev token issuer is enabled when `ENV` is `local`/`test`, or when `DEMO_AUTH=true` on a
non-production deployment. The prompt also wants a separate *demo* deployment whose Vercel
target is Production, which conflicts with "refuse to start when `DEMO_AUTH=true` and
`VERCEL_ENV=production`". The demo project therefore sets `RULES_DEPLOYMENT=demo`. The
service refuses to start when `DEMO_AUTH=true`, `VERCEL_ENV=production` and
`RULES_DEPLOYMENT` is not `demo`. Outside local runs, `DEMO_AUTH` also requires an explicit
`DEV_JWT_SECRET`, and `ENV=production` requires OIDC settings. The issuer only mints tokens
for the five seeded users. Demo tokens carry `iss=rules-dev-issuer` and are rejected
whenever the issuer is disabled.

### D-105 Test case semantics
A test passes when every key in `expected` deep-equals the same key in the output (floats
compared with a 1e-9 tolerance). Extra output keys are allowed. Test inputs may contain
their own `caller` block (needed for role-aware rules such as `approval-limit`). Live
evaluations always overwrite `caller` with `{roles, app}` from the verified token, so callers
cannot spoof roles.

### D-106 Lifecycle edge cases
- `activate` accepts drafts only. Re-enabling a disabled version uses `enable`. Both run the
  test gate; a failure returns `409` with the full test report.
- `deprecate` accepts active or deprecated versions; on a deprecated version it updates the
  sunset date.
- The first activation of a decision creates its `default` alias automatically.
- Alias names match `^[a-z][a-z0-9-]{0,63}$`.

### D-107 Caches and serverless safety
Parsed `ZenDecision` objects are cached per instance by version id (LRU, immutable content).
Alias → version id is cached with a 5 s TTL and invalidated locally on alias changes. Other
instances converge within the TTL. Version status is read from Postgres on every evaluate,
so disabling takes effect immediately everywhere. Usage counting is a single
`INSERT … ON CONFLICT DO UPDATE count = count + 1` per evaluate. SQLAlchemy uses `NullPool`
with psycopg 3 and `prepare_threshold=None`, which is safe behind Neon's PgBouncer.

### D-108 Expression linting uses ZEN's compiler, not its validator
`ZenDecision.validate()` checks graph structure but not cell expressions, which otherwise
only fail at evaluation time. zen-engine 2.1.3's `validate_unary_expression` also rejects
valid shorthand that the engine evaluates correctly (`< 18`, `> 1, < 3`). Saves therefore
compile every table cell, expression and switch condition with
`compile_unary_expression` / `compile_expression`, and report failures per node, rule and
column as `422`.

### D-109 Multi-environment promotion (out of scope; design note)
Environments (DEV/UAT/PROD) can be added without schema churn as **alias namespaces**:
`dev:default`, `uat:default`, `prod:default`. Promotion then means moving the next
environment's alias to an already-tested version, with the same audit trail and test gate.
If per-environment RBAC is needed, add an `environment` column to `decision_aliases` and
`role_grants` and include it in the unique keys.

### D-110 Weighted traffic splitting (out of scope)
`decision_aliases.weights` (nullable JSONB) is in the schema. The resolver has a
`TODO(canary)` at the point where an alias with weights would choose a version.

### D-111 decisionNode references
The ZEN loader resolves `decisionNode` keys `"{app}/{decision}@{versionId}"` (exact) or
`"{app}/{decision}"` (the referenced decision's `default` alias), and never loads disabled
versions.

## Phase 1b — AI authoring

### D-120 One JSON envelope for every provider
Providers are asked for `{summary, explanation, jdm}`, with `jdm` as a **JSON-encoded string**.
Decision-table rows have dynamic keys (the column ids), which strict structured-output JSON
schemas cannot express. A fixed envelope works with Anthropic `output_config.format`
(`json_schema`), OpenAI and Azure `response_format: json_schema` (strict), and, for
OpenAI-compatible servers, a JSON-only instruction plus extraction. Set
`options.structured_outputs=true` on a compatible provider that supports `json_schema`.
Validation stage (a) parses both the envelope and the embedded JDM.

### D-121 Anthropic SDK takes no sampling parameters — **Deviation**
`anthropic` 2.6 (`Messages.create`) no longer accepts `temperature`/`top_p`. The
`ai_providers.temperature` column applies to the OpenAI-family providers only. The
Anthropic SDK authenticates with `Authorization: Bearer` and uses `httpx2`; the OpenAI SDK
uses `httpx`. Tests inject a mock transport for each SDK, so the real SDK code paths run
offline.

### D-122 `generation_runs` additions — **Deviation (additive)**
Beyond the prompt's columns, `generation_runs` has `kind` (`generate | explain |
test_connection`), `app_id` and `provider_name`. Explain calls and connection tests then
count toward usage reports and monthly token budgets, and runs stay attributable after a
provider is renamed or deleted.

### D-123 Global default provider
Model names live only in configuration (`AI_DEFAULT_MODEL`, provider rows). Generation stays
disabled for an app until an admin creates its `app_ai_settings`. `AI_DEFAULT_PROVIDER`
picks the provider when an admin enables AI without naming one
(`PUT /v1/apps/{app}/ai/settings {}` uses the enabled provider of that type). The seed's
Anthropic row takes its model from `AI_DEFAULT_MODEL`.

### D-124 Generation pipeline behaviour
- **Retries:** timeouts, connection errors, 5xx, 408 and 429 are retried once, then the
  app's fallback provider is tried. Other errors (such as 401) fail fast with a redacted
  502.
- **Validation:** (a) parse, (b) Pydantic JDM model, (c) ZEN load plus expression compile,
  (d) every supplied example and every stored test case (subset match, D-105). Any failure
  sends the specific errors back to the model, up to `AI_MAX_REPAIR_ATTEMPTS` repairs. The
  final failure returns 422 with the report and the last (redacted) output.
- **Guardrails:** per-user and per-app hourly rate limits, and monthly token budgets, are
  computed from `generation_runs` in Postgres (serverless-safe). The budget is checked
  before every provider call, including repairs. Prompt, context, example count and total
  request size are capped (413).
- **Time:** each call's timeout is the smallest of the provider's `timeout_s`,
  `AI_CALL_TIMEOUT_CAP_S` and the remaining `AI_TOTAL_BUDGET_S` (240 s). The Vercel function
  `maxDuration` is 300 s.
- **Prompt injection:** `context_text` is wrapped in `<context_document>` delimiters; any
  closing tag inside it is neutralised. The system prompt states that the document is data.
- **No auto-activation:** generated versions are drafts with
  `author = ai:<provider>/<model>` and `requested_by = <user>`, and go through the same
  activation gate as hand-written versions.

### D-125 Secrets
`api_key_ref` accepts only references (`env:NAME`, `aws-sm:NAME`; more schemes via
`register_scheme`). Values that look like keys are rejected. Every resolved secret is
remembered in-process and replaced with `[redacted]` in errors, logs, run reports and
audit entries, as are key-shaped strings (`sk-…`, bearer tokens). A canary-key test checks
API responses, logs, every database table, audit and usage output.

### D-126 Out of scope: file extraction
`GenerateRequest` has a `TODO(file-extraction)`: PDF/DOCX uploads will be converted to text
and fed into `context_text`.

## Phase 2 — shared packages

### D-201 json-render specifics
- Specs use json-render's flat format `{ root, elements, state }`.
- The prompt's "Button with `action` binding" is json-render's element-level
  `on: { press: { action, params } }`.
- Catalog actions: `navigate`, `submit`, `refresh`, `openModal`, `closeModal`, `toast`.
- Two additive components: `Modal` (opened by `openModal` via state `/ui/modal`) and `Text`.
- `DataTable` rows carry their own action bindings, so the BFF decides per row which actions
  are offered (e.g. no "Disable" on an aliased version).

### D-202 Validated specs carry normalized props
json-render hands components the raw props and does not apply Zod defaults.
`validateScreenSpec()` (used by the BFF before responding and by the runtime before
rendering) parses every element's props with its component schema and returns a spec whose
props are the parsed output, with defaults applied. It also checks dangling children,
the root, and that every `on` binding names a known action.

### D-203 Domain components fetch through BFF actions
`JdmEditor`, `VersionDiff`, `TestPanel`, `AiGeneratePanel` and `ProviderSettings` get
references (app, decision, version) in their props. They load and save through
`HostServices.callAction` (`loadVersion`, `saveVersion`, `diff`, `evaluate`, `generate`, …),
which `@rules/sdui-runtime` implements as `POST /bff/<mfe>/actions/<action>`. Graph JSON is
never embedded in a spec. The GoRules editor bundle (antd, Monaco, React Flow) is
lazy-loaded the first time an editor renders.

### D-204 Payload references in `submit`
`submit` params can reference form state anywhere in the payload: `{ "$state": "/path" }`,
`{ "$json": "/path" }` (parses a `JsonField` string) and `{ "$number": "/path" }`. The
runtime resolves them just before POSTing, so the BFF always receives typed JSON.

### D-205 Workspace packages are consumed as TypeScript source
`packages/*` export `src/*.ts(x)` directly; Vite, Vitest, `tsx` and `tsc` all consume them
without a build step. The generic packages (`ui-registry` generic components, `sdui-runtime`,
`auth`) import nothing from the rules domain. The domain components live in
`packages/ui-registry/src/domain/` and are joined to the catalog in exactly one place
(`catalog.ts` / `react.tsx`), so they can be dropped to extract a generic package.

### D-206 Generated API client is committed
`packages/api-client/openapi.json` and `src/schema.d.ts` are generated
(`pnpm --filter @rules/api-client generate`) and committed, so JS jobs need no Python. CI
fails if they drift from the service's OpenAPI document.

## Phase 3 — BFF

### D-301 Browser authentication through the BFF
- The browser never holds a token in JavaScript. In local and demo environments,
  `POST /bff/session/login` mints a token with the rules-service dev issuer and stores it in
  an HttpOnly, `SameSite=Lax` cookie (`Secure` on Vercel).
- Every BFF call forwards that token to rules-service as `Authorization: Bearer …`. A
  request that already carries an `Authorization` header (an OIDC-enabled SPA) is forwarded
  as is.
- The BFF keeps no session or rule state. It calls `GET /v1/me` per screen to shape the spec.
- Demo mode comes from rules-service's `/health` (`demo_auth`). The BFF never decides it on
  its own.

### D-302 Screen shaping rules
- Lifecycle and alias controls appear only for `publish`. Per-row actions follow the version
  status: activate (draft), deprecate (active), disable (active or deprecated **and not
  aliased**), enable (disabled), point alias (active or deprecated).
- Editors get a writable editor and the AI panel. Viewers get a read-only graph. Admin
  screens return 403 to non-admins. Provider configuration is listed only to global admins.
- rules-service enforces all of these again; the BFF only shapes what is shown.

### D-303 BFF tests run against captured fixtures
BFF tests use an in-process fake rules-service that answers from JSON captured from a
freshly seeded instance (`apps/api/bff/test/capture-fixtures.sh`), so the JS CI job needs
no database. End-to-end behaviour against the real service is covered by Playwright in
Phase 5.

## Phase 4 — micro-frontends and shell

### D-401 Shell ↔ remote contract
Each remote exposes one default component taking `RemoteAppProps`:
`{ basePath, location, navigate, session, config }` (`@rules/sdui-runtime`).
- The shell owns the session, routing (History API) and the permission-filtered nav: Rules
  and Releases need `view`, Admin needs `admin`.
- Each remote maps its sub-path to a BFF screen and wraps it in its own `SessionProvider`,
  so remotes do not depend on React context crossing a federation boundary.
- Every remote is wrapped in a per-remote error boundary with Retry. A failed remote load
  is not cached, so Retry works once the remote is back.

### D-402 Shared singletons; `@json-render/core` is eager
`react`, `react-dom`, `@json-render/*`, `@rules/ui-registry/*`, `@rules/sdui-runtime` and
`@rules/auth*` are shared singletons (`federation.shared.ts`; CI checks the file is
identical in all four apps). `@json-render/core` is marked `eager`: `@json-render/react`'s
schema module calls `defineSchema` while it is being evaluated. Without `eager`, a remote
running as its own page (standalone production build) failed with
`defineSchema is not a function` before the lazy share resolved.

### D-403 Standalone remotes use a mock session
`StandaloneHost` runs a remote without the shell. It proxies `/bff` to the BFF, and when
demo login is available it signs in as `VITE_MOCK_USER` (defaults: carol for Rules, bob for
Releases, alice for Admin), with a visible "Standalone remote · mock session" banner.

### D-404 Graph comparisons ignore key order
Postgres JSONB does not preserve object key order, so the editor's "unsaved changes" check
compares graphs with a key-sorted serialization.

### D-405 Bundle size
The GoRules editor (antd, Monaco, React Flow) is a lazy chunk. Because `ui-registry` is a
shared singleton, each app build contains the chunk, but browsers download it only when an
editor renders.

## Phase 5 — end-to-end tests and docs

### D-501 End-to-end suite
`e2e/` (Playwright 1.63) runs against any running stack (`E2E_BASE_URL`,
`E2E_RULES_SERVICE_URL`). `demo.spec.ts` follows `docs/DEMO.md` step by step: it edits a
real table cell in the GoRules editor, uses the TestPanel, diffs, activates with an alias,
calls the API as `svc-loan`, disables, rolls back, generates with the mock provider and
audits. It starts by checking for freshly seeded data and fails with a clear message
otherwise. `mfe.spec.ts` covers remote loading, permission-filtered nav, isolation of a
failing remote, invalid-spec error states and standalone remotes. CI runs both against
docker compose (`pnpm e2e:compose`).

### D-502 Toasts survive navigation
Actions such as "Save as new draft" navigate to the new version, which remounts the
screen. Toasts live in a module-level store in `@rules/sdui-runtime`, so the confirmation
is not lost.

### D-503 Demo step 6 wording
The demo checks v2's usage *after* step 5 has called it once, so the usage table shows one
call (the demo's own) rather than zero. `DEMO.md` says so explicitly.

## Phase 6 — Vercel + Neon

### D-601 The shell proxies `/bff/*` with an edge function — **Deviation**
The prompt asks for a `vercel.json` rewrite from the shell to the BFF. Rewrites cannot read
environment variables, so every preview shell would call the production BFF. The shell
instead uses the Build Output API with a small edge function that forwards `/bff/*` to
`BFF_URL` for that deployment, so the browser still sees a single origin. The static files,
the SPA fallback and the cache headers are declared in the same output `config.json`.

### D-602 The BFF ships as one esbuild bundle
Workspace packages export TypeScript source (D-205), so the BFF is bundled with esbuild into
a single Node.js 22 function (Build Output API), and the bundle has no runtime dependency
on the monorepo. Verified locally by serving the bundled handler from outside the
repository.

### D-603 Deployments are driven by GitHub Actions
`deploy.yml` creates or reuses the PR's Neon branch, migrates it (direct URL), seeds it,
then deploys previews with per-deployment env: rules-service → BFF → changed remotes →
shell. The shell's manifest points at the preview remotes that were deployed and falls back
to production remotes for unchanged ones; `turbo-ignore` decides which changed. The job
then runs the Playwright suite against the preview and comments the URLs on the PR.

On merge, the job migrates Neon `main`, deploys production, and asserts that production
rejects demo login: `/v1/dev/token` returns 404, `/health` reports `demo_auth:false`, and
unauthenticated calls return 401. Each app's `vercel.json` keeps `npx turbo-ignore` as
the Ignored Build Step for teams that prefer Git-triggered builds.

### D-604 Deployment Protection
Preview deployments are protected. Server-to-server calls (shell → BFF → rules-service)
and Playwright send the "Protection Bypass for Automation" secret. The three remote
projects serve only public static JavaScript and must be unprotected, because a protected
remote cannot be loaded as a module from the shell's origin.

### D-605 Client bundle secret scan
CI builds the web apps with canary values in every secret-bearing env var, then greps all
built static assets for those values and for key-shaped strings (Anthropic/OpenAI keys,
credentialed Postgres URLs, private keys, Neon passwords). A planted canary was confirmed
to fail the check.

### D-606 Status of the live deployment
Vercel and Neon APIs are not reachable from the build session, and the repository has no
Vercel or Neon secrets yet. The workflows therefore skip with a summary listing the missing
secrets, and the Phase 6 PR stays open until they are configured. Verified locally:
- the BFF bundle serves requests;
- the shell's Build Output (static files, manifest from env, edge proxy forwarding
  cookies, query strings and bodies) works;
- `zen-engine` runs on Amazon Linux 2023 / Python 3.12 (D-007).

### D-607 Three Vercel projects, Git-integrated, Neon via the Vercel integration (supersedes parts of D-601, D-603, D-604)
Six projects plus an Actions-driven deploy were too much to maintain. The deployment is now:
- **`rules-web`**: the shell and all three remotes in **one** Build Output. Remotes are
  built with `base: /_mfe/<name>/` and served same-origin, so the runtime manifest uses
  relative entries (`/_mfe/rules/remoteEntry.js`). Remotes are workspace deps of the shell,
  so `turbo-ignore` rebuilds the web project when any remote changes. Local dev and docker
  compose still run the remotes on their own ports.
- **`rules-bff`** and **`rules-api`**: unchanged builds.
- **Wiring:** Vercel *Related Projects* (`relatedProjects` in `vercel.json`, read through
  `VERCEL_RELATED_PROJECTS`). The web edge proxy finds the BFF and the BFF finds the API,
  using the same git branch's preview, or production for production. `BFF_URL` and
  `RULES_SERVICE_URL` stay as fallbacks.
- **Database:** the **Neon–Vercel integration** on `rules-api` creates a branch per preview
  deployment and injects `DATABASE_URL` / `DATABASE_URL_UNPOOLED`. Migrations run in
  `rules-api`'s **build** (`scripts/vercel_build.py`), before the deployment receives
  traffic and never at cold start. Previews are seeded idempotently; production is never
  seeded unless it is the explicit demo deployment.
- **Deploys** come from Vercel's Git integration. `deploy.yml` now only verifies them on
  `deployment_status`: the Playwright smoke suite on web previews, and the "production
  rejects demo login" guard. The full, data-mutating demo path stays in CI against docker
  compose, where the database is reset per run. The Phase 0 spike workflow was removed:
  every `rules-api` deployment now exercises `zen-engine` on Vercel.
- **Safety:** when `ENV` is unset it follows `VERCEL_ENV`, so a forgotten variable can no
  longer leave a Vercel deployment in `local` mode with the dev token issuer enabled.

Verified locally: the combined web Build Output, served by an emulation of its routes and
edge proxy against a real BFF and API, passes the e2e suite (13/13; the standalone-remote
tests don't apply). Build-time migration and seeding were checked against Postgres
(fresh preview, re-run, production, missing URL). Not verifiable from the build session:
the Vercel and Neon platforms themselves.
