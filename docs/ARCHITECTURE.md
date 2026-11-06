# Architecture

> Filled in progressively; the full version with diagrams lands in Phase 5.

```
Browser
  └─ shell (host) ──loads──▶ mfe-rules | mfe-releases | mfe-admin   (Module Federation, runtime manifest)
        │  GET  /bff/<mfe>/screens/<screen>  → json-render spec (Zod-validated)
        │  POST /bff/<mfe>/actions/<action>  → mutations
        ▼
  bff (Hono, Node)  ──bearer token──▶  rules-service (FastAPI + zen-engine + Postgres)
                                          └─ authoring/ → LLM providers (Anthropic | OpenAI | compatible | mock)
```

| Port | Service |
|---|---|
| 5173 | shell |
| 5174 / 5175 / 5176 | mfe-rules / mfe-releases / mfe-admin |
| 8787 | bff |
| 8000 | rules-service |
| 5432 | postgres |
