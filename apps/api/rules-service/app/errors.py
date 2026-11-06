"""RFC 7807 problem+json errors."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"


class Problem(Exception):
    status = 500
    title = "Internal Server Error"
    type_ = "about:blank"

    def __init__(self, detail: str, *, headers: dict[str, str] | None = None, **extra: Any) -> None:
        super().__init__(detail)
        self.detail = detail
        self.extra = extra
        self.headers = headers or {}


class BadRequest(Problem):
    status, title, type_ = 400, "Bad Request", "https://rules.dev/problems/bad-request"


class Unauthorized(Problem):
    status, title, type_ = 401, "Unauthorized", "https://rules.dev/problems/unauthorized"


class Forbidden(Problem):
    status, title, type_ = 403, "Forbidden", "https://rules.dev/problems/forbidden"


class NotFound(Problem):
    status, title, type_ = 404, "Not Found", "https://rules.dev/problems/not-found"


class Conflict(Problem):
    status, title, type_ = 409, "Conflict", "https://rules.dev/problems/conflict"


class Gone(Problem):
    status, title, type_ = 410, "Gone", "https://rules.dev/problems/version-disabled"


class Unprocessable(Problem):
    status, title, type_ = 422, "Unprocessable Content", "https://rules.dev/problems/invalid-decision"


class TooManyRequests(Problem):
    status, title, type_ = 429, "Too Many Requests", "https://rules.dev/problems/rate-limited"


class UpstreamError(Problem):
    status, title, type_ = 502, "Bad Gateway", "https://rules.dev/problems/upstream"


def problem_response(
    status: int,
    title: str,
    detail: str,
    type_: str,
    instance: str,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body = {"type": type_, "title": title, "status": status, "detail": detail, "instance": instance, **extra}
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(Problem)
    async def _problem(request: Request, exc: Problem) -> JSONResponse:
        return problem_response(
            exc.status, exc.title, exc.detail, exc.type_, request.url.path, exc.headers, **exc.extra
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": list(e.get("loc", ())), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
        return problem_response(
            422,
            "Unprocessable Content",
            "Request validation failed",
            "https://rules.dev/problems/validation",
            request.url.path,
            errors=errors,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem_response(exc.status_code, str(exc.detail), str(exc.detail), "about:blank", request.url.path)


class PayloadTooLarge(Problem):
    status, title, type_ = 413, "Content Too Large", "https://rules.dev/problems/too-large"
