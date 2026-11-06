"""Run a decision's stored test cases (and ad-hoc examples) against a version."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DecisionVersion, TestCase
from app.schemas import TestReport, TestResult
from app.services import engine
from app.services.jdm import clean_engine_error


def subset_mismatches(expected: Any, actual: Any, path: str = "") -> list[str]:
    """Every key in `expected` must equal the same key in `actual`; extra output keys are fine."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path or '$'}: expected object, got {actual!r}"]
        out: list[str] = []
        for k, v in expected.items():
            sub = f"{path}.{k}" if path else k
            if k not in actual:
                out.append(f"{sub}: missing (expected {v!r})")
            else:
                out.extend(subset_mismatches(v, actual[k], sub))
        return out
    if isinstance(expected, float) or isinstance(actual, float):
        try:
            if abs(float(expected) - float(actual)) < 1e-9:
                return []
        except (TypeError, ValueError):
            pass
    return [] if expected == actual else [f"{path or '$'}: expected {expected!r}, got {actual!r}"]


def with_default_caller(context: dict[str, Any], app_key: str) -> dict[str, Any]:
    """Test inputs may set `caller` explicitly (e.g. role-aware rules); otherwise use an empty one."""
    if "caller" in context:
        return context
    return {**context, "caller": {"roles": [], "app": app_key}}


def run_cases(
    evaluate_fn: Any, cases: list[tuple[str, dict[str, Any], dict[str, Any]]], app_key: str
) -> list[TestResult]:
    results = []
    for name, input_, expected in cases:
        try:
            actual = evaluate_fn(with_default_caller(input_, app_key))["result"]
        except Exception as exc:
            results.append(
                TestResult(name=name, passed=False, expected=expected, error=clean_engine_error(str(exc)))
            )
            continue
        mismatches = subset_mismatches(expected, actual)
        results.append(
            TestResult(
                name=name, passed=not mismatches, expected=expected, actual=actual, mismatches=mismatches
            )
        )
    return results


def report(results: list[TestResult], version: int | None = None) -> TestReport:
    passed = sum(r.passed for r in results)
    return TestReport(
        version=version, total=len(results), passed=passed, failed=len(results) - passed, results=results
    )


def run_stored_tests(db: Session, version: DecisionVersion, app_key: str) -> TestReport:
    cases = db.scalars(
        select(TestCase).where(TestCase.decision_id == version.decision_id).order_by(TestCase.id)
    )
    triples = [(c.name, c.input, c.expected) for c in cases]
    results = run_cases(lambda ctx: engine.evaluate(db, version, ctx, False), triples, app_key)
    return report(results, version.version)
