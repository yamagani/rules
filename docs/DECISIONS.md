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
