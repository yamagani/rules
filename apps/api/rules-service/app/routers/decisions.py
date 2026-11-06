from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Body, Query, Response, status
from sqlalchemy import func, select

from app.auth import rbac
from app.deps import DB, CurrentPrincipal, load_app, load_decision, load_version
from app.errors import Conflict
from app.models import Decision, DecisionVersion, EvaluationStat, Permission, TestCase, VersionStatus
from app.schemas import (
    ALIAS_PATTERN,
    ActivateRequest,
    AliasOut,
    AliasPut,
    DecisionCreate,
    DecisionDetail,
    DecisionSummary,
    DeprecateRequest,
    DiffOut,
    EnableRequest,
    EvaluateResponse,
    LifecycleResult,
    TestCaseIn,
    TestCaseOut,
    TestReport,
    UsageDay,
    UsageOut,
    VersionCreate,
    VersionOut,
    VersionSummary,
    VersionUsage,
)
from app.services import audit, diff, evaluation, lifecycle, testing

router = APIRouter(prefix="/v1/apps/{app}/decisions", tags=["decisions"])

AliasName = Annotated[str, Query(pattern=ALIAS_PATTERN)]


def _summary(db: DB, decision: Decision) -> DecisionSummary:
    rows = db.execute(
        select(DecisionVersion.version, DecisionVersion.status)
        .where(DecisionVersion.decision_id == decision.id)
        .order_by(DecisionVersion.version)
    ).all()
    aliases = {a.alias: a.version for a in lifecycle.alias_list(db, decision)}
    s = DecisionSummary.model_validate(decision)
    s.latest_version = rows[-1][0] if rows else None
    s.default_version = aliases.get(lifecycle.DEFAULT_ALIAS)
    s.active_versions = [v for v, st in rows if st == VersionStatus.active]
    s.draft_count = sum(1 for _, st in rows if st == VersionStatus.draft)
    return s


@router.get("", response_model=list[DecisionSummary])
def list_decisions(app: str, db: DB, principal: CurrentPrincipal) -> list[DecisionSummary]:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decisions = db.scalars(select(Decision).where(Decision.app_id == application.id).order_by(Decision.key))
    return [_summary(db, d) for d in decisions]


@router.post("", response_model=DecisionSummary, status_code=status.HTTP_201_CREATED)
def create_decision(app: str, body: DecisionCreate, db: DB, principal: CurrentPrincipal) -> DecisionSummary:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    if db.scalar(select(Decision.id).where(Decision.app_id == application.id, Decision.key == body.key)):
        raise Conflict(f"Decision '{body.key}' already exists in '{app}'")
    decision = Decision(app_id=application.id, key=body.key, name=body.name, description=body.description)
    db.add(decision)
    db.flush()
    audit.record(db, principal.subject, "decision.created", application, decision, key=body.key, name=body.name)
    db.commit()
    return _summary(db, decision)


@router.get("/{key}", response_model=DecisionDetail)
def get_decision(app: str, key: str, db: DB, principal: CurrentPrincipal) -> DecisionDetail:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decision = load_decision(db, application, key)
    alias_map = lifecycle.aliases_by_version(db, decision)
    versions = list(
        db.scalars(
            select(DecisionVersion)
            .where(DecisionVersion.decision_id == decision.id)
            .order_by(DecisionVersion.version.desc())
        )
    )
    summaries = [lifecycle.summary(v, alias_map) for v in versions]
    drafts = [s for s in summaries if s.status == VersionStatus.draft]
    return DecisionDetail(
        **_summary(db, decision).model_dump(),
        app=application.key,
        versions=summaries,
        aliases=lifecycle.alias_list(db, decision),
        latest_draft=drafts[0] if drafts else None,
    )


# --- versions --------------------------------------------------------------------
@router.get("/{key}/versions", response_model=list[VersionSummary])
def list_versions(app: str, key: str, db: DB, principal: CurrentPrincipal) -> list[VersionSummary]:
    return get_decision(app, key, db, principal).versions


@router.get("/{key}/versions/{version}", response_model=VersionOut)
def get_version(app: str, key: str, version: int, db: DB, principal: CurrentPrincipal) -> VersionOut:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decision = load_decision(db, application, key)
    row = load_version(db, decision, version)
    s = lifecycle.summary(row, lifecycle.aliases_by_version(db, decision))
    return VersionOut(**s.model_dump(), content=row.content)


@router.post("/{key}/versions", response_model=VersionSummary, status_code=status.HTTP_201_CREATED)
def create_version(app: str, key: str, body: VersionCreate, db: DB, principal: CurrentPrincipal) -> VersionSummary:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    decision = load_decision(db, application, key)
    row = lifecycle.create_version(
        db, application, decision, body.content, author=principal.subject, comment=body.comment
    )
    db.commit()
    return lifecycle.summary(row, {})


@router.get("/{key}/diff", response_model=DiffOut)
def diff_versions(
    app: str,
    key: str,
    db: DB,
    principal: CurrentPrincipal,
    from_: Annotated[int, Query(alias="from")],
    to: int,
) -> DiffOut:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decision = load_decision(db, application, key)
    a, b = load_version(db, decision, from_), load_version(db, decision, to)
    changes = diff.diff(a.content, b.content)
    return DiffOut(
        from_version=from_,
        to_version=to,
        changes=changes,
        summary=diff.summarize(changes),
        from_content=a.content,
        to_content=b.content,
    )


def _lifecycle_result(db: DB, decision: Decision, row: DecisionVersion, tests: TestReport | None) -> LifecycleResult:
    db.refresh(row)
    return LifecycleResult(
        version=lifecycle.summary(row, lifecycle.aliases_by_version(db, decision)),
        tests=tests,
        aliases=lifecycle.alias_list(db, decision),
    )


@router.post("/{key}/versions/{version}/activate", response_model=LifecycleResult)
def activate(
    app: str,
    key: str,
    version: int,
    db: DB,
    principal: CurrentPrincipal,
    body: Annotated[ActivateRequest | None, Body()] = None,
    force: bool = False,
) -> LifecycleResult:
    body = body or ActivateRequest()
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.publish)
    decision = load_decision(db, application, key)
    row = load_version(db, decision, version, for_update=True)
    tests = lifecycle.activate(db, application, decision, row, principal, body.aliases, body.force or force)
    db.commit()
    return _lifecycle_result(db, decision, row, tests)


@router.post("/{key}/versions/{version}/deprecate", response_model=LifecycleResult)
def deprecate(
    app: str,
    key: str,
    version: int,
    db: DB,
    principal: CurrentPrincipal,
    body: Annotated[DeprecateRequest | None, Body()] = None,
) -> LifecycleResult:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.publish)
    decision = load_decision(db, application, key)
    row = load_version(db, decision, version, for_update=True)
    lifecycle.deprecate(db, application, decision, row, principal.subject, (body or DeprecateRequest()).sunset_at)
    db.commit()
    return _lifecycle_result(db, decision, row, None)


@router.post("/{key}/versions/{version}/disable", response_model=LifecycleResult)
def disable(app: str, key: str, version: int, db: DB, principal: CurrentPrincipal) -> LifecycleResult:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.publish)
    decision = load_decision(db, application, key)
    row = load_version(db, decision, version, for_update=True)
    lifecycle.disable(db, application, decision, row, principal.subject)
    db.commit()
    return _lifecycle_result(db, decision, row, None)


@router.post("/{key}/versions/{version}/enable", response_model=LifecycleResult)
def enable(
    app: str,
    key: str,
    version: int,
    db: DB,
    principal: CurrentPrincipal,
    body: Annotated[EnableRequest | None, Body()] = None,
) -> LifecycleResult:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.publish)
    decision = load_decision(db, application, key)
    row = load_version(db, decision, version, for_update=True)
    tests = lifecycle.enable(db, application, decision, row, principal, (body or EnableRequest()).force)
    db.commit()
    return _lifecycle_result(db, decision, row, tests)


@router.post("/{key}/versions/{version}/run-tests", response_model=TestReport)
def run_tests(app: str, key: str, version: int, db: DB, principal: CurrentPrincipal) -> TestReport:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    decision = load_decision(db, application, key)
    return testing.run_stored_tests(db, load_version(db, decision, version), application.key)


# --- aliases -----------------------------------------------------------------------
@router.put("/{key}/aliases/{alias}", response_model=list[AliasOut])
def put_alias(app: str, key: str, alias: str, body: AliasPut, db: DB, principal: CurrentPrincipal) -> list[AliasOut]:
    import re

    from app.errors import BadRequest

    if not re.match(ALIAS_PATTERN, alias):
        raise BadRequest(f"Invalid alias name '{alias}'")
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.publish)
    decision = load_decision(db, application, key)
    row = load_version(db, decision, body.version)
    lifecycle.put_alias(db, application, decision, alias, row, principal.subject)
    db.commit()
    return lifecycle.alias_list(db, decision)


@router.delete("/{key}/aliases/{alias}", response_model=list[AliasOut])
def delete_alias(app: str, key: str, alias: str, db: DB, principal: CurrentPrincipal) -> list[AliasOut]:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.publish)
    decision = load_decision(db, application, key)
    lifecycle.delete_alias(db, application, decision, alias, principal.subject)
    db.commit()
    return lifecycle.alias_list(db, decision)


# --- test cases --------------------------------------------------------------------
@router.get("/{key}/tests", response_model=list[TestCaseOut])
def list_tests(app: str, key: str, db: DB, principal: CurrentPrincipal) -> list[TestCase]:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decision = load_decision(db, application, key)
    return list(db.scalars(select(TestCase).where(TestCase.decision_id == decision.id).order_by(TestCase.id)))


@router.post("/{key}/tests", response_model=TestCaseOut, status_code=status.HTTP_201_CREATED)
def add_test(app: str, key: str, body: TestCaseIn, db: DB, principal: CurrentPrincipal) -> TestCase:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    decision = load_decision(db, application, key)
    case = TestCase(decision_id=decision.id, name=body.name, input=body.input, expected=body.expected)
    db.add(case)
    db.flush()
    audit.record(db, principal.subject, "test_case.created", application, decision, name=body.name)
    db.commit()
    return case


@router.delete("/{key}/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test(app: str, key: str, test_id: int, db: DB, principal: CurrentPrincipal) -> Response:
    from app.errors import NotFound

    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    decision = load_decision(db, application, key)
    case = db.scalar(select(TestCase).where(TestCase.id == test_id, TestCase.decision_id == decision.id))
    if case is None:
        raise NotFound(f"Test case {test_id} not found")
    db.delete(case)
    audit.record(db, principal.subject, "test_case.deleted", application, decision, name=case.name)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- evaluate & usage ----------------------------------------------------------------
@router.post("/{key}/evaluate", response_model=EvaluateResponse)
def evaluate(
    app: str,
    key: str,
    response: Response,
    db: DB,
    principal: CurrentPrincipal,
    context: Annotated[dict[str, Any], Body()],
    version: int | None = None,
    alias: AliasName | None = None,
    draft: bool = False,
    trace: bool = False,
) -> EvaluateResponse:
    application = load_app(db, app)
    decision = load_decision(db, application, key)
    result, headers = evaluation.evaluate(
        db, application, decision, principal, context, version=version, alias=alias, draft=draft, trace=trace
    )
    response.headers.update(headers)
    return result


@router.get("/{key}/usage", response_model=UsageOut)
def usage(
    app: str, key: str, db: DB, principal: CurrentPrincipal, days: Annotated[int, Query(ge=1, le=365)] = 30
) -> UsageOut:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decision = load_decision(db, application, key)
    since = datetime.now(UTC).date() - timedelta(days=days - 1)
    stats = db.execute(
        select(EvaluationStat.version_id, EvaluationStat.day, EvaluationStat.count)
        .where(EvaluationStat.decision_id == decision.id, EvaluationStat.day >= since)
        .order_by(EvaluationStat.day)
    ).all()
    last_used = dict(
        db.execute(
            select(EvaluationStat.version_id, func.max(EvaluationStat.day))
            .where(EvaluationStat.decision_id == decision.id)
            .group_by(EvaluationStat.version_id)
        )
        .tuples()
        .all()
    )
    by_version: dict[int, list[UsageDay]] = {}
    for version_id, day, count in stats:
        by_version.setdefault(version_id, []).append(UsageDay(day=day, count=count))
    alias_map = lifecycle.aliases_by_version(db, decision)
    versions = db.scalars(
        select(DecisionVersion)
        .where(DecisionVersion.decision_id == decision.id, DecisionVersion.status != VersionStatus.draft)
        .order_by(DecisionVersion.version.desc())
    )
    return UsageOut(
        decision=key,
        days=days,
        versions=[
            VersionUsage(
                version=v.version,
                status=v.status,
                aliases=alias_map.get(v.id, []),
                total=sum(d.count for d in by_version.get(v.id, [])),
                last_used=last_used.get(v.id),
                days=by_version.get(v.id, []),
            )
            for v in versions
        ],
    )
