"""Seed demo data: `uv run python -m app.seed [--reset]`.

Never run against production: refuses when ENV=production or VERCEL_ENV=production
(unless RULES_DEPLOYMENT=demo).
"""

import argparse
import sys

from app.config import get_settings
from app.db import _session_factory
from app.seed.load import reset, seed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="truncate all tables first")
    args = parser.parse_args()
    settings = get_settings()
    if settings.env == "production" or settings.is_vercel_production:
        print("refusing to seed a production database", file=sys.stderr)
        return 2
    with _session_factory()() as db:
        if args.reset:
            reset(db)
        created = seed(db)
        db.commit()
    print("seeded" if created else "already seeded; use --reset to start over")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
