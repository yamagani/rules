#!/bin/sh
# Container entrypoint for local/docker use. Deployed environments run migrations in CI
# (never at function cold start) and seed only preview/demo branches.
set -e
alembic upgrade head
if [ "$ENV" = "local" ]; then python -m app.seed; fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
