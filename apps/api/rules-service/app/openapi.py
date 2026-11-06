"""Write the OpenAPI document: `uv run python -m app.openapi [path]` (default: stdout)."""

import json
import sys

from app.main import app


def main() -> None:
    doc = json.dumps(app.openapi(), indent=2, sort_keys=True)
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w") as fh:
            fh.write(doc + "\n")
    else:
        print(doc)


if __name__ == "__main__":
    main()
