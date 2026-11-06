# Architecture

## Components

```mermaid
flowchart LR
  subgraph Browser
    Shell["shell (host)\nsession · nav · error boundaries"]
    R["mfe-rules\n/rules/*"]
    Rel["mfe-releases\n/releases/*"]
    A["mfe-admin\n/admin/*"]
    Shell -- "Module Federation\n(runtime manifest)" --> R & Rel & A
  end
  subgraph Edge["Same origin: shell domain"]
    BFF["bff (Hono)\nscreens + actions\nZod in / out"]
  end
  subgraph Service["rules-service (FastAPI)"]
    API["REST /v1\nRBAC on every endpoint"]
    ZEN["ZEN engine\n(cached by version id)"]
    AUTH["authoring/\nprompt → LLM → validate → repair"]
  end
  DB[("Postgres / Neon\nversions · aliases · grants\naudit · stats · AI runs")]
  LLM["LLM providers\nAnthropic · OpenAI/Azure\ncompatible · mock"]

  R & Rel & A -- "GET /bff/&lt;mfe&gt;/screens/*\nPOST /bff/&lt;mfe&gt;/actions/*" --> BFF
  BFF -- "bearer token (from HttpOnly cookie)" --> API
  API --> ZEN
  API --> AUTH --> LLM
  API --> DB
```

| Piece | Responsibility | Never does |
|---|---|---|
| **shell** | Session, login (demo) or OIDC hand-off, permission-filtered nav, loads remotes from `/mfe-manifest.json`, isolates failures | Talk to rules-service, hold tokens in JS |
| **remotes** | Map their sub-routes to BFF screens; render specs with `@rules/sdui-runtime` | Hardcode screens or permissions |
| **bff** | Build json-render specs from service data **and** the caller's permissions; validate every spec (Zod catalog) and every action payload (`@rules/schemas`) | Store rule state, enforce security, call LLMs |
| **rules-service** | Source of truth: versions, lifecycle, aliases, RBAC, audit, evaluation, AI generation | Trust the BFF's view of permissions |

## Server-driven UI

```mermaid
sequenceDiagram
  participant Remote as remote (sdui-runtime)
  participant BFF
  participant RS as rules-service
  Remote->>BFF: GET /bff/releases/screens/versions?decision=eligibility
  BFF->>RS: GET /v1/me (permissions)
  BFF->>RS: GET /v1/apps/…/decisions/eligibility, …/usage
  BFF->>BFF: SpecBuilder → validateScreenSpec (Zod catalog)
  BFF-->>Remote: json-render spec (only actions the user may take)
  Remote->>Remote: validateScreenSpec again → render with registry
  Note over Remote: user clicks "Activate"
  Remote->>BFF: POST /bff/releases/actions/activate {app, decision, version, aliases}
  BFF->>BFF: Zod payload check (400 + fieldErrors)
  BFF->>RS: POST …/versions/5/activate (forwarded bearer token)
  RS->>RS: RBAC (publish) → run stored tests → activate → move aliases → audit
  RS-->>BFF: 200 / 409 problem+json
  BFF-->>Remote: {ok, message} → toast + refetch screen
```

- **Catalog** (`packages/ui-registry/src/catalog.ts`): Zod prop schemas for every
  component. It is server-safe; the BFF imports it to validate before responding.
- **Registry** (`packages/ui-registry/src/react.tsx`): the React implementation of each
  catalog component. Domain components (`JdmEditor`, `VersionDiff`, `TestPanel`,
  `AiGeneratePanel`, `ProviderSettings`, `AuditTimeline`) live in `src/domain/` and load
  heavy data through BFF actions. The graph JSON is never embedded in a spec.
- **Runtime** (`packages/sdui-runtime`): `useScreen` → validate → `JSONUIProvider` +
  `Renderer`, with action handlers for `navigate`, `submit`, `refresh`, `openModal`,
  `closeModal` and `toast`.

## Evaluation and version resolution

```mermaid
flowchart TD
  Q["POST …/evaluate"] --> V{"?version=n"}
  V -- yes --> ROW
  V -- no --> AL{"?alias=name"}
  AL -- yes --> CACHE["alias → version id\n(5 s TTL cache)"] --> ROW
  AL -- no --> DR{"?draft=true"}
  DR -- yes --> LATEST["latest draft\n(needs edit)"] --> ROW
  DR -- no --> DEF["default alias"] --> CACHE
  ROW["read version row (status is never cached)"] --> S{status}
  S -- disabled --> G["410 Gone + alternatives"]
  S -- draft --> E{"caller has edit?"}
  E -- no --> F["403"]
  E -- yes --> RUN
  S -- "active / deprecated" --> RUN["ZEN evaluate\n(parsed decision cached by version id)\ncaller = {roles, app} from token"]
  RUN --> H["X-Rule-Version, meta.version\nDeprecation / Sunset when deprecated\n+1 evaluation_stats (upsert)"]
```

## Version lifecycle

```mermaid
stateDiagram-v2
  [*] --> draft: save (new immutable row)
  draft --> active: activate (publish + tests pass)
  active --> deprecated: deprecate (optional sunset)
  deprecated --> deprecated: update sunset
  active --> disabled: disable (no alias points here)
  deprecated --> disabled: disable (no alias points here)
  disabled --> active: enable (publish + tests pass)
```

Any number of versions can be active at once. Aliases (`default`, `stable`, `beta`, …)
point only at active or deprecated versions. Rollback means moving `default` back.
Content is immutable: a database trigger rejects updates to `content` and `checksum`.

## AI rule generation

```mermaid
flowchart LR
  P["prompt + schema +\nexamples + context"] --> T["versioned prompt\ntemplates (generate.v1)"]
  T --> C["provider call\n(retry once → fallback)"]
  C --> A{"(a) JSON\n(b) JDM schema\n(c) ZEN load\n(d) examples + stored tests"}
  A -- fail --> R["repair: send errors back\n(≤ AI_MAX_REPAIR_ATTEMPTS)"] --> C
  A -- pass --> D["draft version\nauthor = ai:provider/model"]
  D --> GR["generation_runs + audit"]
  A -- "final failure" --> X["422 + report + last output"]
```

Guardrails: per-user and per-app hourly limits and monthly token budgets (counted in
Postgres), input caps, `context_text` delimited as data, and API keys resolved only inside
rules-service through `SecretResolver` and redacted everywhere. Generated drafts go through
the same activation gate as hand-written ones.

## Auth and RBAC

- **Local/demo:** the rules-service dev issuer mints HS256 JWTs for the seeded users. The
  BFF stores the token in an HttpOnly cookie. It runs only when `ENV=local`, or with
  `DEMO_AUTH=true` outside production, and the service refuses to start with demo auth on
  the production deployment.
- **Production:** OIDC (issuer, audience, JWKS URL; roles and groups claims) by
  configuration.
- **Permissions:** `view`, `edit`, `publish`, `evaluate` and `admin`, granted to users or
  groups per application (or globally). `admin` implies everything; `edit` and `publish`
  imply `view`. The UI only *shapes* screens with them; rules-service checks every request.

## Ports (local)

| Port | Service |
|---|---|
| 5173 | shell |
| 5174 / 5175 / 5176 | mfe-rules / mfe-releases / mfe-admin |
| 8787 | bff |
| 8000 | rules-service (`/docs`, `/openapi.json`) |
| 5432 | postgres |

## Repository layout

```
apps/web/{shell,mfe-rules,mfe-releases,mfe-admin}   Vite + React 19 + Module Federation
apps/api/bff                                        Hono BFF
apps/api/rules-service                              FastAPI + SQLAlchemy + Alembic + zen-engine
  app/authoring/                                    LLM providers, prompts, pipeline, guardrails
packages/schemas      shared Zod DTOs and action payloads
packages/ui-registry  json-render catalog (Zod) + React registry (+ domain components)
packages/sdui-runtime fetch → validate → render → dispatch; shell/remote contract
packages/auth         permission helpers, <Can/>, useSession
packages/api-client   generated rules-service client (openapi-typescript + openapi-fetch)
packages/config       tsconfig / eslint / vitest presets
e2e/                  Playwright (demo path, MFE isolation)
infra/                docker-compose, Vercel setup
```
