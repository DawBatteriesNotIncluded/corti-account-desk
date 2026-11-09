# Decisions: why it's built this way

Each section is one decision: what I chose, why, and what I gave up. They map
to what the brief says it cares about.

## 1. Interpreting the problem

**Decision:** the tool answers *"what deserves my attention today, and why"*.
It does not try to describe all 200 accounts.

- An AE with 30 minutes needs a short, ranked list with a reason and a next
  step for each item. Showing everything is the failure mode. The opening
  brief is capped at 8 items.
- "Attention" covers three different jobs, and each gets its own tag:
  - **Protect revenue** (`AT RISK`, `RENEWAL / CLOSE`): churn risk, renewals,
    big deals that look stalled.
  - **Grow revenue** (`GROW`): expansion, trials heating up, lost accounts
    coming back.
  - **Fix the data** (`CRM HYGIENE`): stage contradictions, duplicate accounts,
    usage with no CRM account.
- Growth gets reserved slots in the brief (3 of 8). Otherwise risk items crowd
  it out, and an AE's day isn't only defence.
- **Reference date = 2025-03-14.** Every dataset stops on that day, so the
  tool treats it as "today". Measured against the real date, every account
  would look 18 months stale. It's configurable through `AE_TODAY`.

## 2. Code decides, the LLM explains

**Decision:** all signals, joins, numbers and rankings are deterministic
TypeScript (`src/book.ts`). The Corti model only chooses which tool to call
and writes the answer.

- Numbers that come out of an LLM can't be audited. Numbers that come out of
  code can be tested (`tests/book.test.ts`) and explained (every account
  carries `priorityWhy`).
- The tool still works without the LLM. `npm run brief` and the `/brief` and
  `/account` commands need no model.
- **Tradeoff:** the model can't spot a pattern that code doesn't compute. For
  this brief, I think a tool that is right and auditable beats one that is
  clever and unverifiable.

## 3. Grounding the LLM

**Decision:** the model gets **pre-computed fact cards** through tool calls,
never raw tables. Every answer is then checked.

- **Tools** (`src/tools.ts`): `today_brief`, `get_account`, `find_accounts`,
  `book_summary`, `whats_changed`, `create_task`, `add_note`. Each returns
  compact JSON with values already formatted (`$145k`, `-28%`, `60 days`), so
  the model copies them instead of doing arithmetic.
- **The first model call in every turn must use a tool**
  (`tool_choice: "required"`). In testing, a follow-up question was answered
  from chat memory, and the model invented contacts and notes. Forcing a tool
  call removed that failure.
- **Grounding check** (`groundingCheck` in `src/agent.ts`): every number,
  account id and quoted string in the answer must appear in the tool results
  the model received. Anything that doesn't gets printed as
  `! Not found in the data I retrieved: ...`. It's a cheap, deterministic
  backstop that doesn't rely on the model behaving.
- **Model:** `corti-s1-instant`. In side-by-side runs it gave the same
  tool-calling quality as `corti-s1` at about a third of the latency
  (10–15 s vs 30–40 s). `AE_MODEL=corti-s1` switches back.
- **Tradeoff:** native tool calling ties the tool to an OpenAI-compatible API.
  The alternative was routing intents through JSON in the prompt, which is
  more fragile and harder to extend.

## 4. Joining imperfect data

**Decision:** match on normalised **domain → billing-email domain → name**.
Keep *how* each account was matched as its confidence, and **never merge an
ambiguous group silently**.

- There's no shared key: `customers.external_id` is a synthetic id.
- Normalisation (`src/join/resolve.ts`) strips TLDs, hyphens, legal suffixes
  (Group, LLC…), environment suffixes (`-prod`, `-cloud`, `-trial`…) and the
  `customers` domain suffix.
- Results:
  - 140 accounts match on domain (high confidence).
  - 24 match on billing domain (high).
  - 20 match on name only (medium; the answer says "verify before acting").
  - 16 accounts in 7 duplicate-name clusters are **ambiguous**. Their usage
    isn't attributed, and the tool shows the candidates and says so.
  - CrestlineChild is a clean 1:2 regional mapping. It's kept, and its US and
    EU trends are reported separately because they move in opposite
    directions.
  - 8 usage tenants with no CRM account are listed as a hygiene finding.
- **Rejected:** the generated ids happen to line up by position
  (acc_N ≈ cust_N). That pattern separates every cluster, but it's an artefact
  of how the data was generated, not a real key. I used it only to confirm
  that all 183 unambiguous matches are correct.

## 5. Which signals, and how they were chosen

**Decision:** keep only signals that actually tell accounts apart. The full
profiling is in [`data-inventory.md`](data-inventory.md).

| Kept | Why |
|---|---|
| Production usage trend (last 28 days vs prior 28) | The distribution is trimodal (about −30%, 0%, +40%), so the ±15% cut is robust. 7-day-aligned windows avoid the weekday/weekend skew |
| Declining usage + renewal within 90 days | The strongest churn signal; it combines product and commercial data |
| Big deal (≥ $500k) with < 500 requests in 90 days | Flags the two largest open deals, both barely trialled |
| Low contract balance, **recomputed** | The alerts table is wrong: only 1 of 35 alerts matches its own threshold, and the 3 lowest balances never fired |
| Meeting outcome and note text | Only 9 records, but the sharpest evidence available. Quoted verbatim |
| Prospect / closed-lost with growing usage; reactivation | Win-back and conversion opportunities |
| Tenants diverging (US vs EU) | The account total hides it |

| Dropped | Why |
|---|---|
| `customer_alert_history` | Contradicts the contract balances it's supposed to describe |
| `projects.environment_type` alone | About 50% of "PRODUCTION" usage comes from projects named staging/qa/internal; the name is trusted instead |
| `projects.created_at` ("new project") | Usage predates `created_at` on 121 of 123 projects |
| Overdue tasks as a ranking signal | 152 of 161 open tasks are overdue, so it flags half the book. Shown as context only |
| `persona` | Random for non-technical titles. Roles are inferred from the job title instead |
| model/route/agent/language columns | Fixed mixes with no account-level signal |
| API keys | Inconsistent dates, and no difference between growing and declining accounts |

## 6. MEDDPICC

**Decision:** every account gets a MEDDPICC read, and each element is
**evidence**, **concern** or **unknown**.

- AEs think in MEDDPICC, and it turns "how confident are we in this deal"
  into specific gaps they can act on.
- Each element is mapped to the data that actually exists:
  - **M** Metrics: usage trend and contract consumption.
  - **E** Economic buyer: an executive-titled contact, and whether they've
    been emailed.
  - **D1** Decision criteria: security-review or deep-dive tasks.
  - **D2** Decision process: opportunity stage vs close date.
  - **P** Paper process: legal, contract or pricing steps.
  - **I** Identify pain: negative meetings, concern notes, support tickets.
  - **C1** Champion: inbound engagement, or "no response" notes.
  - **C2** Competition: "lost on price" notes.
- **"Unknown – not captured in the CRM" is a first-class answer.** Decision
  criteria and Competition are mostly unknown, and showing that is more
  useful than guessing.

## 7. Communicating confidence

- **Per finding:** a confidence level plus the source (CRM or analytics) and
  any caveat, e.g. "runway assumes linear burn" or "meeting attendees not
  recorded".
- **Per account:** overall confidence, which drops for name-only or ambiguous
  matches and for assumption-based signals. The priority score is multiplied
  by 0.85 for name-only matches and 0.7 for ambiguous ones, so weaker
  evidence ranks lower.
- **Per answer:** the grounding-check warning plus the list of tools used, so
  the AE can see where the answer came from.

## 8. Helping the AE act

- Every item ends with **"Do:"**: a concrete action, plus who to contact
  (name and title, role inferred from title).
- The tool can create a task or note in the CRM, **only after the AE
  confirms** (y/N). The mock CRM doesn't store writes, and the tool says so.

## 9. Easy to understand and extend

| Add… | Change |
|---|---|
| a signal | one entry in `DETECTORS` (`src/book.ts`) |
| a capability | one entry in `TOOLS` (`src/tools.ts`) |
| a threshold | `THRESHOLDS` in `src/config.ts` |
| an interface | reuse `loadBook()` + `Agent` (the CLI is ~80 lines) |

- **Performance:** one aggregation pass over the 2.2M usage rows, cached in
  `.cache/` and keyed on the DB's size and modification time. Startup is
  about 3 s after the first run.

## 10. What I'd do next with more time

1. A small web UI on the same backend (a design exists). The answer format is
   already structured.
2. Persist AE actions: the mock CRM drops writes, so keep a local log and
   reconcile it.
3. Let the AE confirm ambiguous matches once, and remember the choice.
4. Evals: a fixed question set with expected accounts and facts, run against
   each model and prompt change. The grounding check is the first metric.
5. Calibrate thresholds on outcomes (renewed vs churned) instead of the data
   distribution.
6. Map buying-committee roles properly, which needs meeting attendees.
