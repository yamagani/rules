"""Demo content for the `loan-origination` application."""

from typing import Any

from app.seed.builders import decision_table, switch_with_expressions

# (content, status, comment, aliases)
VersionSeed = tuple[dict[str, Any], str, str, list[str]]
# (name, input, expected)
TestSeed = tuple[str, dict[str, Any], dict[str, Any]]

APP_KEY = "loan-origination"
APP_NAME = "Loan Origination"

# --- eligibility -------------------------------------------------------------------------
ELIG_INPUTS = [
    ("age", "Age", "applicant.age"),
    ("score", "Credit score", "applicant.creditScore"),
    ("amount", "Loan amount", "loan.amount"),
]
ELIG_OUTPUTS = [("eligible", "Eligible", "eligible"), ("reason", "Reason", "reason")]


def _eligibility(min_score: int | None, max_amount: int | None, max_age: int | None = None) -> dict[str, Any]:
    rules = [["< 18", "", "", "false", "'Applicant must be 18 or older'"]]
    if max_age:
        rules.append([f"> {max_age}", "", "", "false", f"'Applicant is older than {max_age}'"])
    if min_score:
        rules.append(["", f"< {min_score}", "", "false", f"'Credit score below {min_score}'"])
    if max_amount:
        rules.append(["", "", f"> {max_amount}", "false", f"'Amount above {max_amount}'"])
    rules.append(["", "", "", "true", "'Eligible'"])
    return decision_table("Eligibility", ELIG_INPUTS, ELIG_OUTPUTS, rules)


ELIGIBILITY_VERSIONS: list[VersionSeed] = [
    # (content, status, comment, aliases)
    (_eligibility(None, None), "disabled", "Initial rule: age only", []),
    (_eligibility(600, None), "deprecated", "Add minimum credit score 600", []),
    (_eligibility(620, 500_000), "active", "Score 620 and 500k cap", ["default", "stable"]),
    (_eligibility(640, 750_000), "active", "Stricter score, higher cap (beta)", ["beta"]),
    (_eligibility(640, 750_000, max_age=75), "draft", "Add maximum age 75", []),
]

ELIGIBILITY_TESTS: list[TestSeed] = [
    (
        "adult with good credit",
        {"applicant": {"age": 35, "creditScore": 760}, "loan": {"amount": 120_000}},
        {"eligible": True},
    ),
    (
        "minor is rejected",
        {"applicant": {"age": 16, "creditScore": 760}, "loan": {"amount": 5_000}},
        {"eligible": False, "reason": "Applicant must be 18 or older"},
    ),
    (
        "poor credit is rejected",
        {"applicant": {"age": 40, "creditScore": 550}, "loan": {"amount": 10_000}},
        {"eligible": False},
    ),
]


# --- pricing --------------------------------------------------------------------------
def _pricing(prime_rate: float) -> dict[str, Any]:
    return switch_with_expressions(
        "Credit band",
        [
            (
                "prime",
                "applicant.creditScore >= 740",
                {"band": "'prime'", "rate": f"{prime_rate} + (loan.amount > 500000 ? 0.0025 : 0)"},
            ),
            ("near-prime", "applicant.creditScore >= 670", {"band": "'near-prime'", "rate": "0.065"}),
            ("subprime", "", {"band": "'subprime'", "rate": "0.095"}),
        ],
    )


PRICING_VERSIONS: list[VersionSeed] = [
    (_pricing(0.045), "active", "Three credit bands", ["default"]),
    (_pricing(0.0425), "draft", "Cut prime rate to 4.25%", []),
]

PRICING_TESTS: list[TestSeed] = [
    ("prime borrower", {"applicant": {"creditScore": 780}, "loan": {"amount": 200_000}}, {"band": "prime"}),
    (
        "near-prime borrower",
        {"applicant": {"creditScore": 700}, "loan": {"amount": 200_000}},
        {"band": "near-prime", "rate": 0.065},
    ),
    (
        "subprime borrower",
        {"applicant": {"creditScore": 600}, "loan": {"amount": 50_000}},
        {"band": "subprime", "rate": 0.095},
    ),
]

# --- approval-limit (role-aware: reads caller.roles injected from the token) --------------
APPROVAL_INPUTS = [("roles", "Caller roles", "caller.roles"), ("amount", "Loan amount", "loan.amount")]
APPROVAL_OUTPUTS = [
    ("approved", "Approved", "approved"),
    ("limit", "Limit", "limit"),
    ("reason", "Reason", "reason"),
]


def _approval(agent_limit: int, manager_limit: int) -> dict[str, Any]:
    return decision_table(
        "Approval limit",
        APPROVAL_INPUTS,
        APPROVAL_OUTPUTS,
        [
            ["'manager' in $", f"<= {manager_limit}", "true", str(manager_limit), "'Within manager limit'"],
            ["'manager' in $", "", "false", str(manager_limit), "'Above manager limit'"],
            ["'agent' in $", f"<= {agent_limit}", "true", str(agent_limit), "'Within agent limit'"],
            ["'agent' in $", "", "false", str(agent_limit), "'Above agent limit'"],
            ["", "", "false", "0", "'No approval authority'"],
        ],
    )


APPROVAL_VERSIONS: list[VersionSeed] = [
    (_approval(25_000, 250_000), "deprecated", "Agents up to 25k", []),
    (_approval(50_000, 250_000), "active", "Agents up to 50k, managers up to 250k", ["default"]),
]

APPROVAL_TESTS: list[TestSeed] = [
    (
        "agent within limit",
        {"caller": {"roles": ["agent"]}, "loan": {"amount": 40_000}},
        {"approved": True, "limit": 50_000},
    ),
    (
        "agent above limit",
        {"caller": {"roles": ["agent"]}, "loan": {"amount": 60_000}},
        {"approved": False, "limit": 50_000},
    ),
    (
        "manager within limit",
        {"caller": {"roles": ["manager"]}, "loan": {"amount": 200_000}},
        {"approved": True, "limit": 250_000},
    ),
    ("no role", {"caller": {"roles": []}, "loan": {"amount": 1_000}}, {"approved": False, "limit": 0}),
]

DECISIONS: list[tuple[str, str, str, list[VersionSeed], list[TestSeed]]] = [
    (
        "eligibility",
        "Loan eligibility",
        "Decision table on age, credit score and amount",
        ELIGIBILITY_VERSIONS,
        ELIGIBILITY_TESTS,
    ),
    (
        "pricing",
        "Loan pricing",
        "Switch on credit band, expression computes the rate",
        PRICING_VERSIONS,
        PRICING_TESTS,
    ),
    (
        "approval-limit",
        "Approval limit",
        "Role-aware limits: agents up to 50k, managers up to 250k",
        APPROVAL_VERSIONS,
        APPROVAL_TESTS,
    ),
]

# (subject_type, subject, app_key or None for global, permission)
GRANTS = [
    ("user", "alice", None, "admin"),
    ("user", "bob", APP_KEY, "edit"),
    ("user", "bob", APP_KEY, "publish"),
    ("user", "carol", APP_KEY, "edit"),
    ("user", "dave", APP_KEY, "view"),
    ("user", "svc-loan", APP_KEY, "evaluate"),
]
