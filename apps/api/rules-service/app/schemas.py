"""Pydantic request/response models. These define the OpenAPI contract that
`packages/api-client` is generated from."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import Permission, SubjectType, VersionStatus

ALIAS_PATTERN = r"^[a-z][a-z0-9-]{0,63}$"
KEY_PATTERN = r"^[a-z0-9][a-z0-9-]{0,99}$"


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- applications -------------------------------------------------------------
class AppOut(ORM):
    id: int
    key: str
    name: str
    created_at: datetime


class AppCreate(BaseModel):
    key: str = Field(pattern=KEY_PATTERN)
    name: str = Field(min_length=1, max_length=200)


# --- decisions ------------------------------------------------------------------
class DecisionCreate(BaseModel):
    key: str = Field(pattern=KEY_PATTERN)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class VersionSummary(ORM):
    id: int
    version: int
    status: VersionStatus
    author: str
    requested_by: str | None = None
    comment: str | None = None
    checksum: str
    sunset_at: datetime | None = None
    created_at: datetime
    activated_at: datetime | None = None
    disabled_at: datetime | None = None
    aliases: list[str] = []


class VersionOut(VersionSummary):
    content: dict[str, Any]


class AliasOut(BaseModel):
    alias: str
    version: int
    updated_by: str
    updated_at: datetime


class DecisionSummary(ORM):
    id: int
    key: str
    name: str
    description: str | None = None
    created_at: datetime
    latest_version: int | None = None
    default_version: int | None = None
    active_versions: list[int] = []
    draft_count: int = 0


class DecisionDetail(DecisionSummary):
    app: str
    versions: list[VersionSummary]
    aliases: list[AliasOut]
    latest_draft: VersionSummary | None = None


class VersionCreate(BaseModel):
    content: dict[str, Any]
    comment: str | None = Field(None, max_length=2000)


class ActivateRequest(BaseModel):
    aliases: list[str] = Field(default_factory=list)
    force: bool = False


class EnableRequest(BaseModel):
    force: bool = False


class DeprecateRequest(BaseModel):
    sunset_at: datetime | None = None


class AliasPut(BaseModel):
    version: int


# --- tests ------------------------------------------------------------------------
class TestCaseIn(BaseModel):
    __test__ = False
    name: str = Field(min_length=1, max_length=200)
    input: dict[str, Any]
    expected: dict[str, Any]


class TestCaseOut(TestCaseIn, ORM):
    id: int


class TestResult(BaseModel):
    __test__ = False
    name: str
    passed: bool
    expected: dict[str, Any]
    actual: dict[str, Any] | None = None
    error: str | None = None
    mismatches: list[str] = []


class TestReport(BaseModel):
    __test__ = False
    version: int | None = None
    total: int
    passed: int
    failed: int
    results: list[TestResult]


class LifecycleResult(BaseModel):
    version: VersionSummary
    tests: TestReport | None = None
    aliases: list[AliasOut] = []


# --- diff -------------------------------------------------------------------------
class DiffChange(BaseModel):
    path: str
    kind: Literal["added", "removed", "changed"]
    before: Any = None
    after: Any = None


class DiffOut(BaseModel):
    from_version: int
    to_version: int
    changes: list[DiffChange]
    summary: dict[str, int]
    from_content: dict[str, Any]
    to_content: dict[str, Any]


# --- evaluate ---------------------------------------------------------------------
class EvaluateMeta(BaseModel):
    app: str
    decision: str
    version: int
    status: VersionStatus
    resolved_by: Literal["version", "alias", "default", "draft"]
    alias: str | None = None
    deprecated: bool = False
    sunset_at: datetime | None = None
    performance: str | None = None


class EvaluateResponse(BaseModel):
    result: Any
    meta: EvaluateMeta
    trace: dict[str, Any] | None = None


# --- usage ------------------------------------------------------------------------
class UsageDay(BaseModel):
    day: date
    count: int


class VersionUsage(BaseModel):
    version: int
    status: VersionStatus
    aliases: list[str]
    total: int
    last_used: date | None
    days: list[UsageDay]


class UsageOut(BaseModel):
    decision: str
    days: int
    versions: list[VersionUsage]


# --- rbac / audit -----------------------------------------------------------------
class GrantIn(BaseModel):
    subject_type: SubjectType = SubjectType.user
    subject: str = Field(min_length=1, max_length=200)
    permission: Permission
    global_: bool = Field(False, alias="global", description="Grant on every application (admin only)")


class GrantOut(ORM):
    id: int
    subject_type: SubjectType
    subject: str
    app: str | None
    permission: Permission


class AuditOut(ORM):
    id: int
    actor: str
    action: str
    decision: str | None = None
    version: int | None = None
    details: dict[str, Any]
    created_at: datetime


class MeOut(BaseModel):
    subject: str
    roles: list[str]
    groups: list[str]
    global_permissions: list[Permission]
    apps: dict[str, list[Permission]]


class DevUserOut(BaseModel):
    username: str
    display_name: str
    description: str
    roles: list[str]
    kind: str


class DevTokenRequest(BaseModel):
    username: str


class DevTokenOut(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105
    user: DevUserOut
