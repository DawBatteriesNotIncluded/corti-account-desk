# Account Desk: an AE copilot

A terminal tool an account executive **talks to** before standup. It opens with
a ranked brief of what needs attention today and why, then answers free-form
questions about any account, the whole book, risk, growth, MEDDPICC gaps or
what changed last week. It can also drill into product usage (metrics, projects, product
mix, leaderboards) and create CRM tasks and notes once the AE confirms. It
only answers account questions: anything else gets a polite refusal plus
suggested tasks for today.

```
Today, 2025-03-14 - whole book (200 accounts, 10 owners) - 8 accounts need attention

1. CrestlineMedical Healthcare (acc_022, customer, owner david.okafor) [AT RISK]  priority 87
   - Production usage -28% (last 28 days vs prior 28) with renewal in 60 days ($145k)
   - Meeting on 2025-03-08 recorded as negative
   - Note 2025-03-08: "Upgrade concerns; AE needs to follow up on dissatisfaction."
   Do: Book a call with Drew Taylor (Chief Medical Officer) before the renewal; find out why usage dropped
   Confidence: high
...
you> Tell me about Ironwood - who should I talk to and where are the MEDDPICC gaps?
```

## Run it

```bash
npm install
npm run set-key        # paste the Corti client secret (saved to .env.local, gitignored)
npm run challenge      # the conversational tool (starts the mock CRM if it isn't running)
```

You also need `data/` from the challenge zip. `data/analytics/analytics.sqlite`
is 537 MB, which is over GitHub's file limit, so it isn't committed.

| Command | What it does |
|---|---|
| `npm run challenge -- --owner jordan.lee` | Scope the tool to one AE's book (the default is the whole book) |
| `npm run brief` / `npm run brief -- --account acc_022` | Deterministic brief or account card. **No LLM needed** |
| `npm run ask -- "What should I do first today?"` | Ask a one-off question without the interactive chat |
| `npm run corti:check` | Check the Corti credentials |
| `npm test` | 38 tests: join, signals, MEDDPICC, confidence, usage tools, scope guard, grounding check, Corti auth |

In the chat: `/brief`, `/account <name|id>`, `/owner <id|all>`, `/reset`, `/quit`.

## Approach

```
CRM HTTP API ──► crm/client.ts (paged, retrying, null-tolerant)  ─┐
analytics.sqlite ──► analytics/usage.ts (1 pass, cached) ─────────┤
                                                                  ▼
                     join/resolve.ts: domain → billing domain → name, with confidence
                                                                  ▼
            book.ts: findings (signals) · MEDDPICC · priority · next step   ◄── deterministic, tested
                                                                  ▼
            tools.ts: fact cards ──► agent.ts: Corti tool calling + grounding check ──► cli.ts
```

1. **Load both sources.** The CRM is read only through its HTTP API, roughly
   800 paginated calls with retries. The analytics DB is aggregated once
   (2.2M rows) and cached.
2. **Join** CRM accounts to usage tenants with no shared key. Each match keeps
   its method and confidence. Ambiguous duplicates are shown, never merged.
3. **Compute findings.** Each signal says what it means (risk, grow,
   renewal, watch, hygiene) and carries evidence, source, confidence, caveat
   and a suggested action. Only signals that separate accounts are used; see
   [docs/data-inventory.md](docs/data-inventory.md).
4. **MEDDPICC read** per account. Each element is marked evidence, concern
   or unknown, based on the data that exists.
5. **Rank** with an explainable score: signal points + value at stake, scaled
   down for weaker matches.
6. **Converse.** Corti Models chooses tools and writes the answer from the
   fact cards. A deterministic check flags any number, account id or quote in
   the answer that isn't in the data it retrieved.

**Why each choice:** [docs/DECISIONS.md](docs/DECISIONS.md).
**What the data contains and what was dropped:** [docs/data-inventory.md](docs/data-inventory.md).

## Key assumptions

- **"Today" is 2025-03-14,** the last day in both datasets (`AE_TODAY`
  overrides it).
- **"Production" usage** means projects whose names aren't
  staging/qa/internal/sandbox/test/trial/eval. The PRODUCTION label alone
  over-counts by about 2×. NFR (not-for-resale) usage is excluded.
- **Usage trend** compares the last 28 days with the prior 28. It's called
  growing or declining at ±15%, and only when the prior 28 days had at least
  100 requests.
- **Low balance** means 15% or less of a credit/postpaid contract, or 20% or
  less of a prepaid one. These are the thresholds from the alerts table, but
  recomputed from the contracts, because the alert history is unreliable.
  "Runway" assumes the balance is spent evenly over time, and is marked as
  low confidence.
- **Renewal date** comes from the CRM's won renewal opportunity, with the
  contract end date from billing as a fallback. When the two disagree by more
  than 30 days, that's flagged.
- **Contact roles** (executive/EB, technical, operator) are inferred from job
  titles, because the CRM `persona` field is random for non-technical titles.
- **The whole book** is the default scope, because nothing says which of the
  10 owners is "the AE". `--owner` narrows it.

## Tradeoffs

- **Deterministic signals over LLM judgement.** The output is auditable and
  testable, but it can only surface patterns that code computes.
- **Terminal over web UI.** UI isn't graded, and the backend returns
  structured facts that a web UI could render later.
- **Ambiguous matches are left unattributed** rather than guessed. 16 accounts
  lose their usage signals; the tool says so instead of risking a wrong story.
- **`corti-s1-instant` over `corti-s1`** for about 3× lower latency. In my
  side-by-side runs, answer quality was the same.
- **A heuristic priority score,** not a learned model. There are no outcome
  labels to learn from, and the score's components are printed.

## What I'd do next

See [DECISIONS.md §10](docs/DECISIONS.md#10-what-id-do-next-with-more-time):
- a web UI on the same backend;
- saving AE actions locally, since the mock CRM drops writes;
- letting the AE confirm ambiguous matches once;
- an eval set of questions with expected facts;
- calibrating thresholds on renewal outcomes.

## Changes to the provided files

- **`lib/corti.ts`:**
  - OAuth client-credentials auth: the challenge credentials are a client
    id and secret, not a static key. Tokens are cached and refreshed on 401.
  - Tool-calling support (`tools`, `toolChoice`, `toolCalls`).
  - The original `CORTI_API_KEY` path still works.
- **`.gitignore`:** now also excludes `.env*`, the 537 MB analytics DB and
  `.cache/`.
