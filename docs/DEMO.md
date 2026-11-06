# Demo script

A 15-minute walkthrough of authoring, testing, publishing, versioned evaluation, rollback,
AI generation and governance. Every step is automated in `e2e/tests/demo.spec.ts`.

## Setup

```bash
pnpm install
pnpm stack:up        # docker compose: postgres, rules-service, bff, shell, 3 remotes
pnpm stack:reseed    # fresh demo data (run again to restart the demo)
```

Open **http://localhost:5173**. Every screen shows the **Demo mode** banner: logins are
minted by the dev token issuer for the seeded users only.

| User | Can |
|---|---|
| `alice` | global admin |
| `bob` | edit + publish on `loan-origination` |
| `carol` | edit on `loan-origination` (cannot publish) |
| `dave` | view only |
| `svc-loan` | service account, evaluate only |

Starting state of `eligibility`: v1 **disabled**, v2 **deprecated** (with a sunset date),
v3 **active** (`default`, `stable`), v4 **active** (`beta`), v5 **draft**.

## 1. Carol edits the draft visually
Log in as **carol** → **Rules** → **eligibility**. The editor opens the latest draft (v5).
Click **Edit Table** on the *Eligibility* node and change the age cell `> 75` to `> 80`.
Add the comment "Raise maximum age to 80" and click **Save as new draft**. You land on
**v6 (draft)**; v5 is untouched, because saved versions are immutable.

## 2. Carol tests the draft
Open the **Test** tab. The target is *Latest draft (v6)*. Enter:

```json
{ "applicant": { "age": 78, "creditScore": 700 }, "loan": { "amount": 100000 } }
```

Click **Evaluate**: version **6** ran and returned `"eligible": true`. **Show trace** shows
the matched rule.

## 3. Carol cannot publish
There is no **Publish** card on the rules page, and on **Releases → eligibility** the
version rows have no lifecycle buttons and there is no alias form. The BFF omitted them
from her screen spec. rules-service would answer 403 anyway.

## 4. Bob diffs, activates v5 and points `beta` at it
Log in as **bob** → **Releases → eligibility**. In **Diff**, pick *From v3 To v5*: the
change list shows the edited table cells (`/nodes/id=table/content/rules/...`) and a
side-by-side JSON view.

Click **Activate a draft…**, choose **v5**, set *Also point alias* to **beta** and click
**Activate**. The stored test cases run first (toast: *v5 activated (3/3 tests passed)*).
v3, v4 and v5 are now all **active**: `default` and `stable` stay on v3, `beta` moved to v5.

## 5. The loan service calls the rules
```bash
RS=http://localhost:8000
TOKEN=$(curl -s -XPOST $RS/v1/dev/token -H 'content-type: application/json' \
  -d '{"username":"svc-loan"}' | jq -r .access_token)
BODY='{"applicant":{"age":30,"creditScore":700},"loan":{"amount":100000}}'
EVAL="$RS/v1/apps/loan-origination/decisions/eligibility/evaluate"

curl -si -XPOST "$EVAL"            -H "authorization: Bearer $TOKEN" -d "$BODY"   # default  → X-Rule-Version: 3
curl -si -XPOST "$EVAL?alias=beta" -H "authorization: Bearer $TOKEN" -d "$BODY"   # beta     → 5
curl -si -XPOST "$EVAL?version=2"  -H "authorization: Bearer $TOKEN" -d "$BODY"   # Deprecation: true, Sunset: …
curl -si -XPOST "$EVAL?version=1"  -H "authorization: Bearer $TOKEN" -d "$BODY"   # 410 Gone + alternatives
```
Every response carries the version that ran (`X-Rule-Version` and `meta.version`). The 410
body is `application/problem+json` and lists the versions you can use instead.

## 6. Bob retires v2
On **Releases → eligibility**, **Usage (last 30 days)** shows v2 has no regular callers;
the one call is the curl from step 5. Click **Disable** on v2: it is gone immediately on
every instance (status is checked on every evaluate). **Disable** is never offered on v3
or v5, because aliases point at them (rules-service would return 409).

## 7. Bob rolls back
In **Point an alias**, move **default → v5** and click **Move alias**. The step-5 default
call now answers version 5. Move **default → v3** again: that is the rollback, instant
and audited.

## 8. Carol generates a rule with AI
Log in as **carol** → **Rules** → **New decision**: key `fraud-flag`, name *Fraud flag*.
Open **Generate with AI** and describe:

> Flag suspicious transactions as fraud risk: amounts above 10,000 are flagged; on accounts
> younger than 30 days the risk is high, otherwise medium. Everything else is low risk and
> not flagged.

Under **Structured context**, add two examples:

```json
[
  { "input": { "transaction": { "amount": 15000 }, "customer": { "accountAgeDays": 10 } }, "expected": { "flag": true, "risk": "high" } },
  { "input": { "transaction": { "amount": 200 }, "customer": { "accountAgeDays": 400 } }, "expected": { "flag": false, "risk": "low" } }
]
```

Click **Generate draft**. The mock provider returns a decision table, which is validated
(JSON → JDM schema → ZEN load → examples). **Draft version 1** appears with its validation
report (both examples ✓), the model's explanation, and the author `ai:mock/…`.

Click **Open draft v1 in the editor**, change the reason `'Large amount'` to
`'Large amount on an established account'`, and save as **v2**. In **Stored tests**, add a
case (`{"transaction":{"amount":20000},"customer":{"accountAgeDays":5}}` → `{"flag":true,"risk":"high"}`).

## 9. Bob activates the generated rule
**Releases → fraud-flag**: click **Activate** on v2. It goes through the same gate as
hand-written rules (*v2 activated (1/1 tests passed)*) and becomes `default`. AI output is
never activated automatically.

## 10. Alice reviews governance
Log in as **alice** → **Admin**:
- **Audit log**: every lifecycle and alias change with old → new values, including
  *Generated draft v1 with mock/… (run #…)*.
- **AI usage**: runs and tokens per provider and per user.
- **AI providers**: the seeded `anthropic` provider is **disabled** and shows only its key
  *reference* `env:ANTHROPIC_API_KEY`, never a key.

**Optional: real Claude.** Export `ANTHROPIC_API_KEY` (and `AI_DEFAULT_MODEL`) before
`pnpm stack:up`. Then as alice click **Enable** and **Use for this app** on the Anthropic
provider, and **Test connection**. Repeat step 8 with a new decision key.
