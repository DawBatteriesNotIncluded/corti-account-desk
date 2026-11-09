"""Render docs/data-inventory.md from data_inventory.json (tables are generated; narrative is below).
Usage: python -I render_md.py <data_inventory.json> <out.md> <scratchpad_dir>"""
import json, sys, re, collections
inv = json.load(open(sys.argv[1], encoding="utf-8"))
OUT, SP = sys.argv[2], sys.argv[3]
esc = lambda s: str(s).replace("|", "\\|")
short = lambda s: re.sub(r"T08:00:00\.000Z", "", re.sub(r"; \d+ distinct$", "", str(s)))

def col_label(t, c):
    if t["source"] == "crm":
        api = c["api_name"]
        return f"`{api}` ({c['name']})" if api and api != c["name"] else f"`{c['name']}`"
    return f"`{c['name']}`"

def usable_table(t):
    rows = [c for c in t["columns"] if c["verdict"] != "DROP"]
    if not rows: return ""
    L = ["| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |", "|---|---|---|---|---|---|---|---|---|"]
    for c in rows:
        smp = esc(short(c["samples"][0]))[:40] if c["samples"] else ""
        d = "" if c["distinct"] is None else f"{c['distinct']:,}"
        L.append(f"| {col_label(t, c)} | {c['type']} | {c['null_pct']} | {d} | {esc(short(c['summary']))[:120]} | {smp} | {c['verdict']} | {esc(c['reason'])} | {esc(c['use'])} |")
    return "\n".join(L)

T = {(t["source"], t["table"]): t for t in inv["tables"]}
vc = collections.Counter(); per = collections.defaultdict(collections.Counter)
for t in inv["tables"]:
    for c in t["columns"]:
        vc[c["verdict"]] += 1; per[t["source"]][c["verdict"]] += 1

md = []
A = md.append
A("# Data inventory: CRM + analytics")
A("")
A("What in the two data sources is worth using for an AE asking *\"what deserves attention today?\"*, and what isn't. "
  "**Reference date: 2025-03-14** (both datasets end that day; treated as \"today\"). Built from read-only profiling of `data/crm/crm.sqlite` "
  "(read directly for profiling only; the tool itself must use the CRM HTTP API) and `data/analytics/analytics.sqlite`, plus one aggregation pass over "
  "the 2,181,098 `usage_events` rows. Every number below was computed, not estimated. Machine-readable twin: `data_inventory.json`. "
  "200-row per-account preview: `account_preview.csv` (see [Files](#8-files)).")
A("")
A("## TL;DR")
A("")
A(f"- **71 of 106 columns are usable** ({vc['KEEP']} KEEP, {vc['CLEAN-THEN-KEEP']} CLEAN-THEN-KEEP, {vc['DERIVE-ONLY']} DERIVE-ONLY); **{vc['DROP']} are DROP**. Two whole tables are DROP: `api_keys` and `customer_alert_history`.")
A("- **Best signal: the production-only request trend.** Customer-level 28-day changes cluster at about -30%, 0% and +40%, with almost nothing in between. That gives 31 growing and 20 declining accounts out of 184 we can resolve.")
A("- **Don't trust `environment_type`.** 49.8% of PRODUCTION-labelled requests come from projects named staging/qa/internal/sandbox. Classifying by name changes the trend class of 66 accounts and leaves 44 with no production usage at all. This is a business rule, though: volumes and trends look the same under both names.")
A("- **Join:** there is no shared key. Name/domain/billing-domain matching resolves 184 accounts (140 by domain, 24 by billing domain, 20 by name only). 16 accounts in 7 same-name clusters can't be separated using any legitimate field. 8 tenants (cust_200-207, $964k of contracts) have no CRM account.")
A("- **Contracts are usable facts** (balance %, end date), but balances don't reconcile with usage, so any runway projection is an assumption. **Alert history is unusable:** only 1 of 35 alerts fired at its threshold.")
A("- **The CRM's qualitative signal is tiny but sharp:** 4 meetings and 5 notes across 8 accounts. Most other CRM text is templated.")
A("- **Doesn't hold up:** usage dimensions (model/route/agent/language/source), API keys, project `created_at` as \"new project\", overdue tasks (49% of accounts), \"any usage on a prospect\" (every tenant is active daily), and last-week spikes.")
A("- **Strongest combinations for today:** declining usage near renewal (5), big open deal with near-zero product use (2), prospect/closed_lost with growing usage (12), low contract balance (10), and open deals closing within 45 days (18, $5.19M).")
A("")
A("**Verdicts.** KEEP = use as is. CLEAN-THEN-KEEP = usable after the stated normalisation. DERIVE-ONLY = don't show raw; only feeds a derived metric. DROP = constant, empty, redundant, contradicted or no signal.")
A("")
A("| Source | Tables | Columns | KEEP | CLEAN-THEN-KEEP | DERIVE-ONLY | DROP |")
A("|---|---|---|---|---|---|---|")
for s in ["crm", "analytics"]:
    n_t = sum(1 for t in inv["tables"] if t["source"] == s); n_c = sum(per[s].values())
    A(f"| {s} | {n_t} | {n_c} | {per[s]['KEEP']} | {per[s]['CLEAN-THEN-KEEP']} | {per[s]['DERIVE-ONLY']} | {per[s]['DROP']} |")
A(f"| **total** | {len(inv['tables'])} | {sum(vc.values())} | {vc['KEEP']} | {vc['CLEAN-THEN-KEEP']} | {vc['DERIVE-ONLY']} | {vc['DROP']} |")
A("")
A("## 1. Table verdicts")
A("")
A("| Table | Rows | Verdict | Why |")
A("|---|---|---|---|")
for t in inv["tables"]:
    A(f"| {t['source']}.`{t['table']}` | {t['rows']:,} | {t['verdict']} | {esc(t['reason'])} |")
A("")
A("## 2. Usable fields")
A("")
A("CRM columns are shown as `apiName` (db_column), using the mapping in `mock-crm/db.ts`. Through the API, a missing value comes back as `null` rather than being left out. "
  "Every timestamp in both sources is `T08:00:00.000Z`, so treat them as dates.")
for key, title in [(("crm", "accounts"), "CRM `accounts` (GET /accounts)"), (("crm", "contacts"), "CRM `contacts` (GET /accounts/:id/contacts)"),
                   (("crm", "activities"), "CRM `activities` (GET /accounts/:id/activities; fields depend on `type`)"),
                   (("crm", "opportunities"), "CRM `opportunities` (GET /accounts/:id/opportunities)"), (("crm", "tasks"), "CRM `tasks` (GET /accounts/:id/tasks)"),
                   (("analytics", "customers"), "Analytics `customers`"), (("analytics", "projects"), "Analytics `projects`"),
                   (("analytics", "usage_events"), "Analytics `usage_events` (use via aggregates; one scan is ~30 s)"),
                   (("analytics", "contracts"), "Analytics `contracts`"), (("analytics", "alerts"), "Analytics `alerts` (thresholds only)")]:
    A(""); A(f"### {title}"); A(""); A(usable_table(T[key]))
A("")
A("## 3. Derived signals")
A("")
A("Counts are out of 200 accounts (184 resolvable without ambiguity). Usage windows are rolling and anchored on the reference date: "
  "**L28 = 2025-02-15..03-14, P28 = 2025-01-18..02-14**. Every 7-day block holds 5 weekdays and 2 weekend days, which matters because weekday volume is about 2.5x weekend. "
  "NFR rows (2%) are excluded. \"Prod\" means the project name is not staging/qa/internal/sandbox/test/trial/eval (with optional digits).")
A("")
A("| Signal | Definition | Accounts flagged | Separates accounts? | Caveat |")
A("|---|---|---|---|---|")
S = [
 ("**Prod request trend** | L28 vs P28 requests on prod-named projects; growing >= +15%, declining <= -15%; only called if P28 >= 100",
  "31 growing, 20 declining (78 flat, 5 low volume, 50 no prod usage)", "**Yes.** The distribution is trimodal. Calendar weeks (wk8-11 vs wk4-7) give the same class for 143/146", "Book baseline is +3.9%. Trends are per project, so a 1:N account can hide opposite stories"),
 ("**Name-classifier impact** | Same trend, trusting `environment_type` instead of names", "Class changes for 66 (44 lose all prod usage); trend moves >10 pp for 34",
  "Material", "The data can't prove the names right. Show both numbers when they differ"),
 ("**Tokens/transcribe agree?** | Same windows and cut on tokens and transcribe", "All three agree on 94 of 129; tokens on 117 (r = 0.88); transcribe on 100 (r = 0.69)",
  "As a confidence modifier", "Transcribe volumes are small and noisy"),
 ("**Contract balance and runway** | balance/amount; linear burn since `starting_at`; projected exhaustion vs `ending_before`; low = <= 15% credit/postpaid, <= 20% prepaid",
  "114 have a contract: 10 low balance, 29 run out within 60 days, 65 run out before term end", "Low balance and the 60-day cut, yes; \"before term end\" is too broad (57%)",
  "Balance doesn't track usage (burn vs requests r = -0.04), so the runway is an assumption"),
 ("**Days to contract end / renewal** | `ending_before` - today; won-opp `closeDate` - today", "Contract ends within 60 days: 10 (17 within 90); won-opp date within 60 days: 11",
  "Yes", "The two dates disagree (median 77 days apart)"),
 ("**New projects (30 d)** | `projects.created_at` >= 02-12, or first usage >= 02-12", "25 by created_at; 1 by first usage (acc_005)", "No, as defined",
  "Usage predates `created_at` on all 121 projects created inside the window"),
 ("**Tenant started recently** | `customers.created_at` (= first usage) inside the window; or a dormant tenant waking up", "7: acc_001, 036, 109, 151, 182, 188 onboarding; acc_005 reactivated",
  "Yes, specific", "These are the only >= 2x ramps in the data; the spike alert never fired"),
 ("**API keys new / inactive** | Keys created in the last 30 d; `active` = 0", "77 / 85 of 184", "**No.** Same rate on growing, flat and declining accounts", "Table dropped"),
 ("**Pre-customer sandbox** | SANDBOX-labelled usage on a prospect/evaluation/mvp account", "3: acc_002 ($742k), acc_006 ($87k), acc_008 ($1.02M); 27 if name-based",
  "Label version, yes", "cust_006 and cust_008 also hold contracts"),
 ("**Usage on prospect / closed_lost** | Prod usage in L28 > 0", "28 prospects, 20 closed_lost; 12 of them growing; 1 reactivated", "Only the growing subset",
  "Every matched tenant is active daily"),
 ("**Days since CRM contact** | today - `lastContactAt`", "54 of the 138 customer/evaluation/mvp accounts are > 14 days", "Moderate; use as a tiebreaker",
  "Customers max out at 20 days; closed_lost are 45-298"),
 ("**Meeting outcome / note text** | Latest meeting `outcome`; note `text`", "3 positive, 1 negative meeting; 5 notes (8 accounts)", "Yes, but tiny coverage",
  "Meetings have no attendees (`contactIds` is always [])"),
 ("**Open opp value and close date** | `status`=open; `closeDate` - today", "68 open ($13.3M); 18 close within 45 days ($5.19M)", "Yes",
  "Don't use `account.opportunityAmount`; it also carries won renewals"),
 ("**Stage vs reality** | Stage contradicted by contract or usage", "Prospect with contract 21; closed_lost with contract 11; customer without contract 28; customer without prod usage 19",
  "Weak on its own", "Contract presence doesn't depend on stage (62% of prospects vs 59% of customers)"),
 ("**Declining near renewal** | Declining customer, renewal or contract end within 75 days", "5: acc_009, 022, 023, 127, 187", "Yes", "acc_022 also has the only negative meeting"),
 ("**Big deal, low engagement** | Open opp >= $500k and < 500 requests in 90 days", "2: acc_002, acc_008", "Yes", "Both are sandbox trials"),
 ("**Regional divergence** | 1:N tenants trending in different directions", "1: acc_011 (US +53%, EU -23%; the total, +13%, looks flat)", "Yes", "Report per region"),
 ("**Overdue tasks** | Open and `dueDate` < today", "98", "Weak (49%)", "152/161 open tasks are overdue; none are due in the future"),
 ("**Unmatched tenants** | Analytics customers with no CRM account", "8 tenants, $964k of contracts", "n/a", "Outside the 200-account book; CRM hygiene"),
]
for row in S:
    A("| " + " | ".join(row) + " |")
A("")
A("Signals tested and dropped: **last-week vs prior-3-weeks** (no flat account moved 20% or more), **usage-dimension mix or breadth** (see DROP), **API keys**, and **alert history**.")
A("")
A("Core logic (SQLite). In the tool, compute these once into a cache; don't scan per question:")
A("")
A("```sql")
A("WITH proj AS (SELECT id, CASE WHEN name LIKE '%-staging%' OR name LIKE '%-qa%' OR name LIKE '%-internal%' OR name LIKE '%-sandbox%'")
A("                        OR name LIKE '%-test%' OR name LIKE '%-trial%' OR name LIKE '%-eval%' THEN 'nonprod' ELSE 'prod' END cls FROM projects)")
A("SELECT u.customer_id, u.event_type,")
A("       SUM(CASE WHEN u.event_date BETWEEN '2025-02-15' AND '2025-03-14' THEN u.quantity ELSE 0 END) AS l28,")
A("       SUM(CASE WHEN u.event_date BETWEEN '2025-01-18' AND '2025-02-14' THEN u.quantity ELSE 0 END) AS p28")
A("FROM usage_events u JOIN proj p ON p.id = u.project_id")
A("WHERE u.is_nfr = 0 AND p.cls = 'prod'          -- no prod-named project is SANDBOX-labelled")
A("GROUP BY 1, 2;                                  -- change = l28/p28 - 1; sum over the account's matched customers")
A("")
A("SELECT customer_id, type, balance / amount AS balance_pct,")
A("       (amount - balance) / (julianday('2025-03-14') - julianday(substr(starting_at, 1, 10))) AS burn_per_day,   -- linear assumption")
A("       julianday(substr(ending_before, 1, 10)) - julianday('2025-03-14') AS days_to_end")
A("FROM contracts;")
A("```")
A("")
A("## 4. Join notes")
A("")
A("There is no shared key: `customers.external_id` is a unique `synthetic_customer_N` with no CRM counterpart. Normalisation:")
A("")
A("- **CRM:** name in lowercase, drop `Group|LLC|Ltd|Inc|Healthcare` and ` - North/West`, keep `[a-z0-9]`; domain with `.example` and punctuation removed.")
A("- **Analytics:** `customer_name` with `-prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group` removed; `domain` with `.example` and a trailing `customers` removed; the domain of `billing_email`.")
A("- An account and a customer are candidates if any key is equal. Confidence: **domain** > **billing_domain** > **name_only** > **ambiguous** (a connected group with more than one account, or more than one customer, unless it is one account with N regional tenants).")
A("")
A("| Confidence | Accounts | Detail |")
A("|---|---|---|")
A("| domain | 140 | Of 141 customer links: 71 literal, 64 needed hyphen removal (`cornerstone-clinical` = `cornerstoneclinical`), 6 needed the `customers` suffix stripped. Includes acc_011 -> cust_011 (us) + cust_012 (eu) |")
A("| billing_domain | 24 | Customer domain NULL; billing-email domain matches (11 literal, 13 after normalisation) |")
A("| name_only | 20 | 19 CRM accounts have no domain; acc_016 has a domain but its tenant bills from `pinnacleoutpatientold.example` |")
A("| ambiguous | 16 | 7 same-name clusters (below); usage fields are left empty in the preview |")
A("| none | 0 | All 200 accounts have at least one candidate. 8 analytics tenants (cust_200-207) have no account |")
A("")
A("| Cluster | CRM accounts (stage) | Analytics customers | Why it matters | id-order hint* |")
A("|---|---|---|---|---|")
A("| LakeviewMen | acc_010 (eval, $139k, positive meeting 03-14), acc_047 (eval, $369k) | cust_010 (+44%, no contract), cust_046 (+40%, credit 32% left) | Both growing; contract on one | acc_010:cust_010, acc_047:cust_046 |")
A("| SageMedGroup | acc_013 (customer, master agreement $372k), acc_014 North, acc_015 West (branches, no opp), acc_062 (eval, $214k) | cust_014 `holdings` (entity-a/b projects, +38%), cust_061 (qa project only) | Semantic hint: holdings = parent + 2 branches | acc_013/014/015:cust_014, acc_062:cust_061 |")
A("| PrairieAmbulatory | acc_020 (customer, $144k expansion), acc_146 (customer, no domain) | cust_019 (+48%), cust_145 (flat, credit 44% left) | Growth vs flat | acc_020:cust_019, acc_146:cust_145 |")
A("| TrinityRehabilitation | acc_028 (closed_lost), acc_125 (eval, $255k) | cust_027 (-23%), cust_124 (flat) | Decline on a lost or a live deal? | acc_028:cust_027, acc_125:cust_124 |")
A("| VeridianSleep | acc_064 (customer, $299k renewal), acc_137 (closed_lost) | cust_063 (flat, no contract), cust_136 (+34%, prepaid) | Opposite stories | acc_064:cust_063, acc_137:cust_136 |")
A("| CrestlineSenior | acc_069 (customer), acc_152 (customer, no domain) | cust_068 (+42%), cust_151 (flat) | Growth vs flat | acc_069:cust_068, acc_152:cust_151 |")
A("| WindsorFamily | acc_161 (closed_lost), acc_185 (prospect) | cust_160 (flat), cust_184 (flat, postpaid) | Contract on one | acc_161:cust_160, acc_185:cust_184 |")
A("")
A("**Disambiguators tested, none work:** the `created_at` gap between account and customer (random, -638..+769 days); `region` (the CRM has none); `owner_email` (role mailboxes like `owner@`); "
  "stage vs contract presence (independent); contract `ending_before` vs opp `closeDate` (median 77 days apart); opp value vs contract amount (r = 0.12).")
A("")
A("\\* **Generator artefact, not a key:** the ids are aligned by position. acc_N = cust_N for N <= 10; acc_011 = cust_011 + cust_012; acc_012/013 = cust_013/014; acc_014/015 have no tenant; "
  "acc_N = cust_(N-1) for N >= 16. All **183/183** unambiguous matches agree with this pattern, which validates the name/domain join (no false matches). It also implies the pairs in the last column. "
  "Use it to test the join, never as a production rule. In the tool, show both candidates and let the AE confirm.")
A("")
A("## 5. Dropped fields")
A("")
A("| Column | Why dropped |")
A("|---|---|")
for t in inv["tables"]:
    for c in t["columns"]:
        if c["verdict"] == "DROP":
            A(f"| {t['table']}.{col_label(t, c)} | {esc(c['reason'])} |")
A("")
A("Usage dimensions in detail: each one is drawn from a fixed mix per `event_type` (language is always empty on tokens; transcribe models only appear on transcribe events). "
  "Within an event type, though, they don't depend on customer or time. Per customer, a chi-square test against the global mix gives p < 0.05 for 9-14 of 207 customers (about 10 expected by chance). "
  "A shift between the first and last 4 full weeks shows up for 7-12 of 202 (also chance level), and every customer uses every value.")
A("")
A("## 6. Corrections to earlier findings")
A("")
for c in inv["corrections"]:
    A(f"- {c}")
A("- Confirmed as stated: no shared key; all 200 accounts get a candidate; the duplicate lists; cust_200-207 unmatched; opp owner differs from account owner on 112/135; "
  "contact `lastContactedAt` copied 730/730; `is_nfr` is 2.01%; the lowest balances (cust_129 11.0%, cust_126 12.4%, cust_007 12.5%) never fired an alert.")
A("")
A("## 7. Assumptions and caveats")
A("")
for c in inv["caveats"]:
    A(f"- {c}")
A("")
A("## 8. Files")
A("")
A(f"- `{SP}\\data_inventory.json`: every table and column with verdict, reason and use; signals; join; corrections; caveats.")
A(f"- `{SP}\\account_preview.csv`: 200 rows, one per CRM account. Groups of columns: identity and CRM context; match (`match_confidence`, `matched_customer_ids`, "
  "`candidate_customer_ids`, `cluster_id`, `candidates_summary`); usage (prod L28/P28, trend % and class, tokens/transcribe trends, agreement, label-based trend, non-prod share, "
  "12-week series); contract (type, balance %, end, burn, projected exhaustion, low balance); CRM (last contact, open/won opp, tasks, last meeting, latest note); "
  "`flags` (pipe-separated booleans from section 3, not a score). Built only from KEEP/CLEAN-THEN-KEEP/DERIVE-ONLY columns: nothing from `api_keys`, alert history or `projects.created_at`.")
A(f"- `{SP}\\scripts\\`: `build_agg.py` (one pass over usage_events into `work\\agg.sqlite`), `usage_metrics.py`, `joinlib.py`, `build_preview.py`, `assemble_inventory.py`, `render_md.py`, plus the probe scripts used to verify each claim.")
open(OUT, "w", encoding="utf-8").write("\n".join(md) + "\n")
print("lines:", len("\n".join(md).splitlines()))
