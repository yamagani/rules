"""Dev token issuer. Mounted only when ENV=local/test, or DEMO_AUTH=true outside production."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.tokens import AuthError, mint_dev_token
from app.auth.users import DEMO_USERS, DemoUser
from app.config import Settings, get_settings
from app.errors import NotFound
from app.schemas import DevTokenOut, DevTokenRequest, DevUserOut

router = APIRouter(prefix="/v1/dev", tags=["dev-auth"])


def _out(u: DemoUser) -> DevUserOut:
    return DevUserOut(
        username=u.username,
        display_name=u.display_name,
        description=u.description,
        roles=list(u.roles),
        kind=u.kind,
    )


@router.get("/users", response_model=list[DevUserOut])
def users() -> list[DevUserOut]:
    return [_out(u) for u in DEMO_USERS.values()]


@router.post("/token", response_model=DevTokenOut)
def token(body: DevTokenRequest, settings: Annotated[Settings, Depends(get_settings)]) -> DevTokenOut:
    try:
        access_token = mint_dev_token(settings, body.username)
    except AuthError as exc:
        raise NotFound(str(exc)) from exc
    return DevTokenOut(access_token=access_token, user=_out(DEMO_USERS[body.username]))
