"""Seeded demo users. The dev token issuer only mints tokens for these subjects."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DemoUser:
    username: str
    display_name: str
    description: str
    # Business roles, injected as `caller.roles` into every evaluation context.
    roles: tuple[str, ...] = ()
    groups: tuple[str, ...] = field(default_factory=tuple)
    kind: str = "user"


DEMO_USERS: dict[str, DemoUser] = {
    u.username: u
    for u in [
        DemoUser("alice", "Alice Admin", "Global admin", roles=("manager",)),
        DemoUser("bob", "Bob Publisher", "Edit + publish on loan-origination", roles=("manager",)),
        DemoUser("carol", "Carol Author", "Edit on loan-origination (cannot publish)", roles=("agent",)),
        DemoUser("dave", "Dave Viewer", "View only", roles=()),
        DemoUser(
            "svc-loan", "Loan service", "Service account: evaluate only", roles=("agent",), kind="service"
        ),
    ]
}
