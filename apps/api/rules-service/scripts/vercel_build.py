"""Vercel build step for the `rules-api` project.

Runs Alembic migrations against the deployment's database **during the build**, so the
schema is ready before the new deployment receives traffic (never at function cold start).
With the Neon–Vercel integration, every preview deployment gets its own Neon branch and its
connection strings as DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct).

Preview deployments are also seeded with the demo data (idempotent: an existing seed is kept).
Production is never seeded, except the dedicated demo deployment (RULES_DEPLOYMENT=demo).
"""

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def direct_url() -> str | None:
    for name in ("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"):
        if os.environ.get(name):
            return os.environ[name]
    return None


def main() -> int:
    (ROOT / "public").mkdir(exist_ok=True)  # Vercel expects an output directory
    vercel_env = os.environ.get("VERCEL_ENV", "development")
    url = direct_url()
    if not url:
        print(
            "No database URL in the build environment. Connect the Neon integration to this "
            "project (or set DATABASE_URL / DATABASE_URL_UNPOOLED).",
            file=sys.stderr,
        )
        return 1
    os.environ["DATABASE_URL_UNPOOLED"] = url

    from alembic.config import Config

    from alembic import command

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    print(f"[{vercel_env}] alembic upgrade head")
    command.upgrade(cfg, "head")

    seed = vercel_env == "preview" or os.environ.get("RULES_DEPLOYMENT") == "demo"
    if seed:
        os.environ["DATABASE_URL"] = url
        from app.db import _session_factory
        from app.seed.load import seed as seed_data

        with _session_factory()() as db:
            created = seed_data(db)
            db.commit()
        print(f"[{vercel_env}] demo seed {'created' if created else 'already present'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
