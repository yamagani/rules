"""Phase 0 spike: prove zen-engine loads and evaluates inside the deployment runtime.

Kept as a tiny, dependency-free endpoint so it can be hit on a fresh Vercel deployment to
measure cold start (`process_uptime_ms` is small on a cold instance).
"""

import json
import time
from pathlib import Path
from typing import Any

import zen
from fastapi import APIRouter

router = APIRouter(prefix="/spike", tags=["spike"])

_PROCESS_START = time.monotonic()
_SAMPLE = (Path(__file__).parent / "sample.json").read_text()


@router.post("/evaluate")
def spike_evaluate(context: dict[str, Any] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    decision = zen.ZenEngine().create_decision(_SAMPLE)
    result = decision.evaluate(context or {"applicant": {"age": 30}})
    return {
        "result": result["result"],
        "engine_ms": round((time.monotonic() - started) * 1000, 2),
        "process_uptime_ms": round((started - _PROCESS_START) * 1000, 2),
        "zen_sample_nodes": len(json.loads(_SAMPLE)["nodes"]),
    }
