"""AI rule generation: prompt -> provider (retry, fallback) -> validate (parse, schema,
engine, examples) -> repair loop -> draft version + generation_runs row.

Generated rules are never activated here; they land as drafts and go through the same
activation gate (tests + publish permission) as hand-written versions.
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.tokens import Principal
from app.authoring import guardrails, prompting, secrets
from app.authoring.jdm_model import schema_errors
from app.authoring.providers.base import ENVELOPE_SCHEMA, EXPLAIN_SCHEMA, Completion, Message, ProviderError
from app.authoring.providers.factory import build_provider
from app.authoring.schemas import (
    AttemptReport,
    ExampleResult,
    ExplainResponse,
    GenerateRequest,
    GenerateResponse,
    ValidationReport,
)
from app.config import get_settings
from app.errors import BadRequest, Conflict, TooManyRequests, Unprocessable, UpstreamError
from app.models import (
    AiProvider,
    AppAiSettings,
    Application,
    Decision,
    DecisionVersion,
    GenerationRun,
    RunKind,
    RunStatus,
    TestCase,
)
from app.services import audit, engine, lifecycle, testing
from app.services.jdm import validation_issues

log = logging.getLogger("rules.authoring")


# --- provider selection -----------------------------------------------------------------
def app_providers(db: Session, app: Application) -> tuple[AiProvider, AiProvider | None]:
    """The app's primary and fallback providers. Generation is off until an admin enables it."""
    settings = db.get(AppAiSettings, app.id)
    if settings is None:
        raise Conflict(f"AI generation is not enabled for '{app.key}'; an admin must enable a provider")
    primary = db.get(AiProvider, settings.provider_id)
    if primary is None or not primary.enabled:
        raise Conflict(f"The AI provider configured for '{app.key}' is disabled")
    fallback = db.get(AiProvider, settings.fallback_provider_id) if settings.fallback_provider_id else None
    return primary, fallback if fallback and fallback.enabled else None


def choose(db: Session, app: Application, provider_id: int | None) -> list[AiProvider]:
    primary, fallback = app_providers(db, app)
    if provider_id is None or provider_id == primary.id:
        return [primary] + ([fallback] if fallback else [])
    if fallback and provider_id == fallback.id:
        return [fallback]
    raise BadRequest(f"Provider {provider_id} is not enabled for '{app.key}'")


@dataclass
class CallResult:
    completion: Completion
    provider: AiProvider


@dataclass
class RunState:
    started: float = field(default_factory=time.monotonic)
    input_tokens: int = 0
    output_tokens: int = 0
    last_provider: AiProvider | None = None
    last_model: str | None = None

    @property
    def tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)


def call_with_fallback(
    db: Session,
    chain: list[AiProvider],
    system: str,
    messages: list[Message],
    schema: dict[str, Any],
    state: RunState,
) -> CallResult:
    """On timeout/5xx: retry once, then move to the fallback provider. Other errors fail fast."""
    s = get_settings()
    last_error: ProviderError | None = None
    for row in chain:
        guardrails.check_budget(db, row, state.tokens if state.last_provider is row else 0)
        provider = build_provider(row)
        for attempt in (1, 2):
            remaining = s.ai_total_budget_s - (time.monotonic() - state.started)
            if remaining <= 1:
                raise ProviderError("generation time budget exhausted", retryable=False)
            timeout = min(float(row.timeout_s), s.ai_call_timeout_cap_s, remaining)
            try:
                completion = provider.complete(system, messages, schema, row.max_tokens, timeout)
            except ProviderError as exc:
                last_error = exc
                log.warning(
                    json.dumps(
                        {
                            "msg": "provider_call_failed",
                            "provider": row.name,
                            "attempt": attempt,
                            "retryable": exc.retryable,
                            "error": secrets.redact(str(exc)),
                        }
                    )
                )
                if not exc.retryable:
                    raise
                continue
            state.input_tokens += completion.usage.input_tokens
            state.output_tokens += completion.usage.output_tokens
            state.last_provider, state.last_model = row, completion.model or row.model
            return CallResult(completion, row)
    assert last_error is not None
    raise last_error


# --- validation ----------------------------------------------------------------------------
def extract_json(text: str) -> Any:
    """Parse a reply as JSON; tolerate code fences and prose around one JSON object."""
    stripped = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", stripped, re.S)
    if fence:
        stripped = fence.group(1)
    try:
        return json.loads(stripped)
    except ValueError:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start != -1 and end > start:
            return json.loads(stripped[start : end + 1])
        raise


@dataclass
class Validated:
    ok: bool
    stage: str
    errors: list[str]
    envelope: dict[str, Any] = field(default_factory=dict)
    jdm: dict[str, Any] | None = None
    examples: list[ExampleResult] = field(default_factory=list)


def validate_reply(text: str, cases: list[tuple[str, str, dict[str, Any], dict[str, Any]]], app_key: str) -> Validated:
    # (a) parse
    try:
        envelope = extract_json(text)
        if not isinstance(envelope, dict):
            raise ValueError("top-level value is not an object")
        jdm = envelope.get("jdm")
        if isinstance(jdm, str):
            jdm = json.loads(jdm)
        if not isinstance(jdm, dict):
            raise ValueError("'jdm' must be a JSON-encoded JDM object")
    except ValueError as exc:
        return Validated(False, "parse", [f"reply is not valid JSON in the required shape: {exc}"])
    # (b) Pydantic JDM model
    errors = schema_errors(jdm)
    if errors:
        return Validated(False, "schema", errors, envelope, jdm)
    # (c) load with ZEN (graph + every expression)
    issues = validation_issues(jdm)
    if issues:
        msgs = [f"{i['node_name'] or i['node_id'] or 'graph'} ({i['where']}): {i['error']}" for i in issues]
        return Validated(False, "engine", msgs, envelope, jdm)
    # (d) examples + stored test cases
    results = testing.run_cases(
        lambda ctx: engine.evaluate_content(jdm, ctx), [(n, i, e) for n, _, i, e in cases], app_key
    )
    sources = {n: src for n, src, _, _ in cases}
    examples = [ExampleResult(source=sources[r.name], **r.model_dump()) for r in results]
    failing = [e for e in examples if not e.passed]
    errors = [
        f"{e.name} ({e.source}): input {json.dumps(next(i for n, _, i, _ in cases if n == e.name))} "
        + (f"raised {e.error}" if e.error else "; ".join(e.mismatches))
        for e in failing
    ]
    return Validated(not failing, "examples" if failing else "ok", errors, envelope, jdm, examples)


# --- generate --------------------------------------------------------------------------------
def _record_run(
    db: Session,
    *,
    kind: RunKind,
    app: Application,
    decision: Decision | None,
    user: str,
    state: RunState,
    status: RunStatus,
    request: dict[str, Any],
    attempts: int,
    report: dict[str, Any],
    version: DecisionVersion | None,
) -> GenerationRun:
    run = GenerationRun(
        kind=kind,
        app_id=app.id,
        decision_id=decision.id if decision else None,
        version_id=version.id if version else None,
        requested_by=user,
        provider_id=state.last_provider.id if state.last_provider else None,
        provider_name=state.last_provider.name if state.last_provider else None,
        model=state.last_model,
        prompt_template_version=prompting.TEMPLATE_VERSION,
        request=request,
        attempts=attempts,
        status=status,
        validation_report=report,
        input_tokens=state.input_tokens,
        output_tokens=state.output_tokens,
        latency_ms=state.elapsed_ms,
    )
    db.add(run)
    db.flush()
    return run


def generate(
    db: Session, app: Application, decision: Decision, principal: Principal, req: GenerateRequest
) -> GenerateResponse:
    guardrails.check_input_size(req)
    chain = choose(db, app, req.provider_id)
    guardrails.check_rate_limits(db, app, principal.subject)

    base_jdm = None
    if req.base_version is not None:
        base_row = db.scalar(
            select(DecisionVersion).where(
                DecisionVersion.decision_id == decision.id, DecisionVersion.version == req.base_version
            )
        )
        if base_row is None:
            raise BadRequest(f"base_version {req.base_version} does not exist")
        base_jdm = base_row.content

    cases = [(e.name or f"example {i + 1}", "example", e.input, e.expected) for i, e in enumerate(req.examples)]
    stored = db.scalars(select(TestCase).where(TestCase.decision_id == decision.id).order_by(TestCase.id))
    cases += [(f"test: {t.name}", "test_case", t.input, t.expected) for t in stored]

    system = prompting.generate_system()
    messages = [
        Message(
            "user",
            prompting.generate_user(
                req.prompt,
                req.input_schema,
                [e.model_dump() for e in req.examples],
                req.context_text,
                base_jdm,
                req.base_version,
            ),
        )
    ]
    state = RunState()
    attempts: list[AttemptReport] = []
    request_log = req.model_dump(mode="json")
    max_attempts = 1 + get_settings().ai_max_repair_attempts
    result: Validated | None = None
    last_text = ""
    try:
        for attempt in range(1, max_attempts + 1):
            call = call_with_fallback(db, chain, system, messages, ENVELOPE_SCHEMA, state)
            last_text = call.completion.text
            result = validate_reply(last_text, cases, app.key)
            attempts.append(
                AttemptReport(
                    attempt=attempt,
                    provider=call.provider.name,
                    model=state.last_model or call.provider.model,
                    ok=result.ok,
                    stage=result.stage,
                    errors=result.errors,
                )
            )
            if result.ok:
                break
            messages += [
                Message("assistant", last_text),
                Message("user", prompting.repair(result.stage, result.errors)),
            ]
    except (ProviderError, TooManyRequests) as exc:
        message = secrets.redact(str(exc))
        report = ValidationReport(ok=False, attempts=attempts).model_dump(mode="json") | {"error": message}
        run = _record_run(
            db,
            kind=RunKind.generate,
            app=app,
            decision=decision,
            user=principal.subject,
            state=state,
            status=RunStatus.failed,
            request=request_log,
            attempts=len(attempts),
            report=report,
            version=None,
        )
        audit.record(db, principal.subject, "ai.generation_failed", app, decision, None, run_id=run.id, error=message)
        db.commit()
        if isinstance(exc, TooManyRequests):
            raise
        raise UpstreamError(f"The AI provider call failed: {message}", run_id=run.id) from exc

    assert result is not None
    examples = result.examples
    report_model = ValidationReport(
        ok=result.ok,
        attempts=attempts,
        examples=examples,
        passed=sum(e.passed for e in examples),
        failed=sum(not e.passed for e in examples),
    )
    report = report_model.model_dump(mode="json")
    provider_row = state.last_provider
    assert provider_row is not None

    if not result.ok:
        run = _record_run(
            db,
            kind=RunKind.generate,
            app=app,
            decision=decision,
            user=principal.subject,
            state=state,
            status=RunStatus.failed,
            request=request_log,
            attempts=len(attempts),
            report=report,
            version=None,
        )
        audit.record(
            db,
            principal.subject,
            "ai.generation_failed",
            app,
            decision,
            None,
            run_id=run.id,
            provider=provider_row.name,
            model=state.last_model,
            attempts=len(attempts),
            stage=result.stage,
        )
        db.commit()
        raise Unprocessable(
            f"The generated rule failed validation after {len(attempts)} attempt(s)",
            run_id=run.id,
            validation_report=report,
            last_output=secrets.redact(last_text),
        )

    assert result.jdm is not None
    summary = str(result.envelope.get("summary") or "AI-generated rule").strip().splitlines()[0][:200]
    explanation = str(result.envelope.get("explanation") or "").strip()
    version = lifecycle.create_version(
        db,
        app,
        decision,
        result.jdm,
        author=f"ai:{provider_row.name}/{state.last_model}",
        comment=summary,
        requested_by=principal.subject,
        audit_details={"source": "ai"},
    )
    run = _record_run(
        db,
        kind=RunKind.generate,
        app=app,
        decision=decision,
        user=principal.subject,
        state=state,
        status=RunStatus.succeeded,
        request=request_log,
        attempts=len(attempts),
        report=report,
        version=version,
    )
    audit.record(
        db,
        principal.subject,
        "ai.generated",
        app,
        decision,
        version,
        run_id=run.id,
        version=version.version,
        provider=provider_row.name,
        model=state.last_model,
        attempts=len(attempts),
        examples_passed=report_model.passed,
        input_tokens=state.input_tokens,
        output_tokens=state.output_tokens,
    )
    db.commit()
    return GenerateResponse(
        run_id=run.id,
        version=version.version,
        summary=summary,
        explanation=explanation,
        provider=provider_row.name,
        model=state.last_model or provider_row.model,
        validation_report=report_model,
        usage={"input_tokens": state.input_tokens, "output_tokens": state.output_tokens},
    )


# --- explain ---------------------------------------------------------------------------------
def explain(
    db: Session, app: Application, decision: Decision, version: DecisionVersion, principal: Principal
) -> ExplainResponse:
    chain = choose(db, app, None)
    state = RunState()
    request_log = {"version": version.version}
    try:
        call = call_with_fallback(
            db,
            chain,
            prompting.explain_system(),
            [Message("user", prompting.explain_user(version.content, decision.name, version.version))],
            EXPLAIN_SCHEMA,
            state,
        )
        explanation = str(extract_json(call.completion.text).get("explanation", "")).strip()
        if not explanation:
            raise ValueError("empty explanation")
    except (ProviderError, ValueError, AttributeError) as exc:
        message = secrets.redact(str(exc))
        _record_run(
            db,
            kind=RunKind.explain,
            app=app,
            decision=decision,
            user=principal.subject,
            state=state,
            status=RunStatus.failed,
            request=request_log,
            attempts=1,
            report={"error": message},
            version=version,
        )
        db.commit()
        raise UpstreamError(f"The AI provider could not explain this version: {message}") from exc
    _record_run(
        db,
        kind=RunKind.explain,
        app=app,
        decision=decision,
        user=principal.subject,
        state=state,
        status=RunStatus.succeeded,
        request=request_log,
        attempts=1,
        report={},
        version=version,
    )
    db.commit()
    return ExplainResponse(
        version=version.version,
        explanation=explanation,
        provider=call.provider.name,
        model=state.last_model or call.provider.model,
    )


def test_connection(db: Session, row: AiProvider, user: str) -> tuple[bool, int, str | None, str]:
    """Send a tiny request to the provider. Returns (ok, latency_ms, redacted error, model)."""
    started = time.monotonic()
    try:
        guardrails.check_budget(db, row)
        completion = build_provider(row).complete(
            'Reply with the JSON object {"explanation": "ok"}.',
            [Message("user", "ping")],
            EXPLAIN_SCHEMA,
            64,
            min(float(row.timeout_s), 20.0),
        )
    except (ProviderError, TooManyRequests) as exc:
        return False, int((time.monotonic() - started) * 1000), secrets.redact(str(exc)), row.model
    db.add(
        GenerationRun(
            kind=RunKind.test_connection,
            requested_by=user,
            provider_id=row.id,
            provider_name=row.name,
            model=completion.model or row.model,
            status=RunStatus.succeeded,
            attempts=1,
            input_tokens=completion.usage.input_tokens,
            output_tokens=completion.usage.output_tokens,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    )
    db.commit()
    return True, int((time.monotonic() - started) * 1000), None, completion.model or row.model
