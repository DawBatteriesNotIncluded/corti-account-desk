# Account Desk: an AE copilot for Corti

An account executive has 30 minutes before standup. **Account Desk** is a
terminal tool they talk to.

It opens with a ranked list of the accounts that need attention today, each
with the reason, a suggested next step and how confident it is. Then it
answers questions in plain English about:
- any account: contacts, notes, MEDDPICC gaps;
- the whole book: what's at risk, who's ready to grow;
- product usage;
- what changed recently.

Every fact says where it came from, every interpretation is labelled, and
nothing is written to the CRM without the AE's OK.

| Start here | What it is |
|---|---|
| 🧭 **[Miro board: how Account Desk works](https://miro.com/app/board/uXjVEQee7xg=/)** | A visual, non-technical walkthrough: how an answer is made, how MEDDPICC is read, what the confidence levels mean, the guardrails, how accounts are linked, and a worked example. **Best place to start if you aren't technical.** |
| 🎬 **[docs/DEMO.md](docs/DEMO.md)** | A real recorded session, copied in unedited: the brief, account questions, usage, and the off-topic refusal |
| 🧠 **[docs/DECISIONS.md](docs/DECISIONS.md)** | Why it's built this way, decision by decision |
| 🔎 **[docs/data-inventory.md](docs/data-inventory.md)** | What's in the data, what's trustworthy and what was dropped |

---

## Quick start (about 5 minutes)

**You need:**
- **Node.js 22 or newer.** Check with `node --version`.
- **The `data/` folder from the challenge zip.**
- **Corti Models credentials:** tenant, client ID, client secret and
  environment.

The commands are the same in PowerShell, cmd, macOS and Linux.

**1. Install**
```bash
npm install
```

**2. Add the analytics database.** Copy `data/analytics/analytics.sqlite`
from the challenge zip into `data/analytics/` in this folder. At 537 MB it's
too big for GitHub. The CRM database is already included.

**3. Start it**
```bash
npm run challenge
```

The first time, it asks you to **connect to Corti**:
- **Easiest:** paste the whole credentials line as supplied, e.g.
  `CORTI_TENANT_NAME=base CORTI_CLIENT_ID=... CORTI_CLIENT_SECRET=... CORTI_ENVIRONMENT=eu`.
- **Or** press Enter and type each field: tenant (default `base`),
  environment (default `eu`), client ID, client secret.
- **The secret stays hidden while you type.** Everything is saved to
  `.env.local`, which is gitignored and never committed.
- **The connection is tested** before the tool continues.
- **To change the settings later:** run `npm run setup`.

You don't need to start anything else. The tool starts the mock CRM API
itself if it isn't running. The first launch spends about 30 seconds building
a usage cache; after that, startup takes about a second.

> No Corti credentials? The ranked brief and the `/account` cards still work,
> because they don't use the LLM. Only the free-text chat needs Corti.

---

## How to use it

### 1. Read the brief
The tool opens with today's list: the strongest at-risk and growth accounts,
at most 8.

```
TODAY  2025-03-14   whole book (200 accounts) · 8 need attention
────────────────────────────────────────────────────────────────────────────
1. CrestlineMedical Healthcare  [AT RISK]  ● high
   acc_022 · customer · owner david.okafor · priority 87
   • Production usage -28% (last 28 days vs prior 28) with renewal in 60 days ($145k) [CRM+Usage+Billing]
   • Meeting on 2025-03-08 recorded as negative [CRM]
   • Note 2025-03-08: "Upgrade concerns; AE needs to follow up on dissatisfaction." [CRM]
   Suggested: Book a call with Drew Taylor (Chief Medical Officer; role inferred from title) before
              the renewal; find out why usage dropped
   Why this confidence: headline signal is high; account match is high (domain)
...
Also needs attention (18 more above the cut-off): AspenCommunity (acc_009, at risk, priority 47); ...
```

Each account shows:
- a **status:** AT RISK, GROW, RENEWAL, WATCH or CRM HYGIENE;
- a **confidence** level: ● high, ◐ medium or ○ low;
- up to three pieces of **evidence**;
- a **suggested** next step, with who to contact.

The accounts that qualify but didn't fit in the 8 are listed underneath, so
nothing is hidden.

### 2. Ask questions in plain English
| Ask | You get |
|---|---|
| `What should I do first today?` | The top accounts and why, in order |
| `Tell me about CrestlineMedical` | Situation, deal, renewal, contract, usage, MEDDPICC, contacts, notes, next step |
| `Who are the contacts at Ironwood Health?` | Contacts with title, role (inferred from the title) and last email |
| `Where are the MEDDPICC gaps on deals closing soon?` | Concerns and unknowns per deal |
| `What's at risk this quarter?` / `Who is ready to grow?` | Ranked lists with evidence |
| `What is Ironwood Health using?` | Requests, tokens, transcription, projects, product mix, weekly trend |
| `Who are my biggest token users?` | Usage leaderboard: largest, growing or declining |
| `What changed last week?` | Recent CRM activity and the biggest usage moves |
| `Create a task to call Drew Taylor on 2025-03-17` | Shows the task, asks **y/N**, then writes it to the CRM |

Account names can be partial ("Ironwood Health") or ids (`acc_007`). If a
name matches several accounts, the tool asks which one you mean.

The tool **only handles account work.** Ask it something else, like "what's
your favourite dog?", and it says it can't help and suggests three tasks
from today's brief instead.

### 3. Read the answers
| You'll see | It means |
|---|---|
| `[CRM]` `[Usage]` `[Billing]` | Where the fact came from: the CRM API, product usage, or contracts |
| `(role inferred from title)`, `INFERRED` | An interpretation, not a recorded fact. Example: the economic buyer is guessed from job titles |
| `ESTIMATE` | A projection. Example: how long a balance lasts, assuming steady spending |
| `Suggested:` | Advice from the tool, not something in the CRM |
| `● high` `◐ medium` `○ low` + "Why this confidence" | How strong the evidence is, always with the reason. It isn't a churn probability |
| MEDDPICC `✓` `!` `?` | Evidence / concern / unknown ("not captured in the CRM" is a real answer) |
| `↳ looking up get_account ...` | The data lookups the tool made to answer |
| `⚠ Not found in the data I retrieved: ...` | The fact check found a number or quote it couldn't match to the data. Treat it as unverified |

### 4. Commands (instant, no LLM)
| Command | What it does |
|---|---|
| `/brief` | Show today's list again |
| `/account <name or id>` | The full account card |
| `/owner noah.patel` / `/owner all` | Narrow to one AE's book, or go back to the whole book |
| `/links` | The account links you've confirmed |
| `/link acc_010 cust_010` | Confirm which usage record belongs to an ambiguous account (asks y/N) |
| `/unlink acc_010` | Undo a confirmed link |
| `/reset` | Clear the conversation |
| `/help`, `/quit` | Help, exit |

### Other ways to run it
| Command | What it does |
|---|---|
| `npm run challenge -- --owner jordan.lee` | Start scoped to one AE's book |
| `npm run brief` / `npm run brief -- --account acc_022` | Print the brief or one account card and exit. No LLM |
| `npm run ask -- "What should I do first today?"` | Ask one question without the interactive chat |
| `npm run links` | Export the full CRM-account → usage-record mapping to `out/links.csv` |
| `npm run setup` | Re-enter the Corti connection settings |
| `npm run corti:check` | Test the Corti connection |
| `npm run dev` | Run the mock CRM API on its own (port 3001) |
| `npm test` | 41 tests: matching, signals, MEDDPICC, confidence, usage tools, scope guard, fact check, Corti auth |

### Troubleshooting
| Problem | Fix |
|---|---|
| `Analytics DB not found` | Copy `data/analytics/analytics.sqlite` from the challenge zip (step 2) |
| `Corti auth error: HTTP 401` | Run `npm run setup` and check the client ID, secret, tenant and environment (`eu` or `us`) |
| `Could not reach the CRM API` | Port 3001 is busy. Free it, or set another port, e.g. PowerShell `$env:CRM_PORT=3005`, bash `CRM_PORT=3005 npm run challenge` |
| Odd characters or colours in an old console | Turn colours off: PowerShell `$env:NO_COLOR=1`, cmd `set NO_COLOR=1`, bash `NO_COLOR=1 npm run challenge`. Windows Terminal shows everything correctly |
| An answer takes 10–15 s | Normal: each answer is a Corti call plus data lookups. Slash commands are instant |

---

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
- writing confirmed account links into a real CRM custom field (today they are kept in data/links.json, because the mock CRM drops writes);
- an eval set of questions with expected facts;
- calibrating thresholds on renewal outcomes.

## Scope and time

**Core**, built first, within the brief:
- loading both sources;
- matching accounts with confidence;
- the signals, ranking and brief;
- MEDDPICC;
- chat over tools with the fact-check;
- tests and docs.

**Extras**, added afterwards once the core worked:
- the red-team pass;
- source tags and inference labels;
- the off-topic guard;
- usage drill-downs and leaderboards;
- AE-confirmed account links;
- the setup wizard and terminal formatting.

Each extra is small and isolated: one tool entry, one detector entry or one
CLI command. The core stands without them. A chat-first web UI has been
designed (a Claude Design canvas) but not built; the backend already returns
the structured data it needs.

## Changes to the provided files

- **`lib/corti.ts`:**
  - OAuth client-credentials auth: the challenge credentials are a client
    id and secret, not a static key. Tokens are cached and refreshed on 401.
  - Tool-calling support (`tools`, `toolChoice`, `toolCalls`).
  - The original `CORTI_API_KEY` path still works.
- **`.gitignore`:** now also excludes `.env*`, the 537 MB analytics DB and
  `.cache/`.
