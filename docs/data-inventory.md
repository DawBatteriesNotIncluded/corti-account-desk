# Data inventory: CRM + analytics

What in the two data sources is worth using for an AE asking *"what deserves attention today?"*, and what isn't. **Reference date: 2025-03-14** (both datasets end that day; treated as "today"). Built from read-only profiling of `data/crm/crm.sqlite` (read directly for profiling only; the tool itself must use the CRM HTTP API) and `data/analytics/analytics.sqlite`, plus one aggregation pass over the 2,181,098 `usage_events` rows. Every number below was computed, not estimated. Machine-readable twin: `data_inventory.json`. 200-row per-account preview: `account_preview.csv` (see [Files](#8-files)).

## TL;DR

- **71 of 106 columns are usable** (53 KEEP, 9 CLEAN-THEN-KEEP, 9 DERIVE-ONLY); **35 are DROP**. Two whole tables are DROP: `api_keys` and `customer_alert_history`.
- **Best signal: the production-only request trend.** Customer-level 28-day changes cluster at about -30%, 0% and +40%, with almost nothing in between. That gives 31 growing and 20 declining accounts out of 184 we can resolve.
- **Don't trust `environment_type`.** 49.8% of PRODUCTION-labelled requests come from projects named staging/qa/internal/sandbox. Classifying by name changes the trend class of 66 accounts and leaves 44 with no production usage at all. This is a business rule, though: volumes and trends look the same under both names.
- **Join:** there is no shared key. Name/domain/billing-domain matching resolves 184 accounts (140 by domain, 24 by billing domain, 20 by name only). 16 accounts in 7 same-name clusters can't be separated using any legitimate field. 8 tenants (cust_200-207, $964k of contracts) have no CRM account.
- **Contracts are usable facts** (balance %, end date), but balances don't reconcile with usage, so any runway projection is an assumption. **Alert history is unusable:** only 1 of 35 alerts fired at its threshold.
- **The CRM's qualitative signal is tiny but sharp:** 4 meetings and 5 notes across 8 accounts. Most other CRM text is templated.
- **Doesn't hold up:** usage dimensions (model/route/agent/language/source), API keys, project `created_at` as "new project", overdue tasks (49% of accounts), "any usage on a prospect" (every tenant is active daily), and last-week spikes.
- **Strongest combinations for today:** declining usage near renewal (5), big open deal with near-zero product use (2), prospect/closed_lost with growing usage (12), low contract balance (10), and open deals closing within 45 days (18, $5.19M).

**Verdicts.** KEEP = use as is. CLEAN-THEN-KEEP = usable after the stated normalisation. DERIVE-ONLY = don't show raw; only feeds a derived metric. DROP = constant, empty, redundant, contradicted or no signal.

| Source | Tables | Columns | KEEP | CLEAN-THEN-KEEP | DERIVE-ONLY | DROP |
|---|---|---|---|---|---|---|
| crm | 5 | 52 | 36 | 4 | 4 | 8 |
| analytics | 7 | 54 | 17 | 5 | 5 | 27 |
| **total** | 12 | 106 | 53 | 9 | 9 | 35 |

## 1. Table verdicts

| Table | Rows | Verdict | Why |
|---|---|---|---|
| crm.`accounts` | 200 | KEEP | Core commercial record, one row per account (200). Mostly clean; two mirrored opportunity fields and updated_at are redundant. |
| crm.`contacts` | 730 | CLEAN-THEN-KEEP | 730 contacts (1-7 per account). Names/titles usable; persona is noisy, emails of no-domain accounts are placeholders, and last_contacted_at is a copy. |
| crm.`activities` | 267 | KEEP | 267 rows; 198 accounts have 1-3 activities, 2 have none. Sparse and templated, but the 4 meetings and 5 notes are the only qualitative signal in the CRM. |
| crm.`opportunities` | 135 | KEEP | 135 opps, exactly one per account that has one (open 68 / won 67, no lost). Clean apart from owner and stage-change dates. |
| crm.`tasks` | 274 | KEEP | 274 tasks on 136 accounts. Structurally clean but every task is due on or before today, so 'overdue' is the norm. |
| analytics.`customers` | 207 | CLEAN-THEN-KEEP | 207 tenants: 199 map to CRM accounts, 8 (cust_200-207) do not. The join bridge; needs normalising. |
| analytics.`projects` | 415 | CLEAN-THEN-KEEP | 415 projects, 1-3 per customer. The name carries the real environment; created_at and last_active_at are unusable. |
| analytics.`usage_events` | 2,181,098 | KEEP | 2,181,098 events, 2024-12-15..2025-03-14, every tenant active through the last day. Use only via pre-aggregates (customer x project x day x event_type x is_nfr). |
| analytics.`api_keys` | 789 | DROP | 789 keys. Dates are inconsistent and nothing separates accounts: new keys in the last 30 days on 77/184 accounts and inactive keys on 85, at similar rates for growing, flat and declining accounts. |
| analytics.`contracts` | 129 | KEEP | 129 contracts, one per customer, all active on 2025-03-14. Raw facts are fine; balance does not reconcile with usage. |
| analytics.`alerts` | 3 | DERIVE-ONLY | 3 alert definitions. Useful only for their thresholds, to recompute alerts ourselves. |
| analytics.`customer_alert_history` | 35 | DROP | 35 rows, all 'triggered'. Only 1 of 35 fired at or below its threshold; 23 fired with >50% balance left; 9 customers at/below threshold (incl. the 3 lowest) never fired; the spike alert never fired. |

## 2. Usable fields

CRM columns are shown as `apiName` (db_column), using the mapping in `mock-crm/db.ts`. Through the API, a missing value comes back as `null` rather than being left out. Every timestamp in both sources is `T08:00:00.000Z`, so treat them as dates.

### CRM `accounts` (GET /accounts)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 200 | acc_001 .. acc_200 | acc_014 | KEEP | Primary key and API path parameter. | Key for every CRM call; preview row id. |
| `name` | TEXT | 0.0 | 198 | AcmePathology LLC .. WindsorFamily Inc | SageMedGroup Group - North | CLEAN-THEN-KEEP | Display name; needs normalising for the join (drop Group/LLC/Ltd/Inc/Healthcare and ' - North/West', strip punctuation). 2 exact duplicate names and 7 duplicate-name clusters. | Join key #3 (name) to customers.customer_name; display. |
| `domain` | TEXT | 11.5 | 174 | acme-physician.example .. windsorfamily.example | sagemedgroup-north.example | CLEAN-THEN-KEEP | Best join key but 23 null (11.5%); strip '.example' and hyphens (64 of 141 domain links needed hyphen removal). 3 domains are shared by two accounts. | Join key #1 (domain) and #2 (vs billing-email domain). |
| `industry` | TEXT | 0.0 | 9 | Ambulatory .. Telehealth | Hospital | KEEP | 9 clean values (one generic 'Healthcare'). | Context/filters only. |
| `employeeCount` (employee_count) | INTEGER | 0.0 | 195 | 111 .. 8970 | 196 | KEEP | Populated 100%; plausible range. Not related to icpTier. | Context (size). |
| `ownerId` (owner_id) | TEXT | 0.0 | 10 | alex.rivera .. tom.wright | david.okafor | KEEP | 10 owners; consistent with task owners (274/274). | Who owns the account; book filter. |
| `stage` | TEXT | 0.0 | 5 | customer (77), evaluation (48), prospect (35), closed_lost (27), mvp (13) | customer | KEEP | 5 values; consistent with stage_change activities (to_stage = stage on all 88) and opportunity stages. | Commercial state; base for stage-vs-reality checks. |
| `createdAt` (created_at) | TEXT | 0.0 | 183 | 2022-09-28 .. 2025-02-24 | 2024-07-06 | DERIVE-ONLY | Valid dates, but gap to customers.created_at is random (-638..+769 days), so it does not help disambiguate. | Account age only. |
| `lastContactAt` (last_contact_at) | TEXT | 0.0 | 57 | 2024-05-20 .. 2025-03-14 | 2025-03-03 | KEEP | Matches the latest email/meeting/note on 158 of 172 accounts that have one; the only trustworthy recency field. | Signal: days since last CRM contact. |
| `nextStep` (next_step) | TEXT | 32.0 | 23 | Approve expansion .. Synced with parent accou | Synced with parent account | KEEP | 23 templated phrases; identical to the opportunity nextStep on all 135 accounts with an opp; null for all prospects/closed_lost. | Context in answers ('next step: Send proposal'). |
| `icpTier` (icp_tier) | TEXT | 0.0 | 4 | mid_market (53), enterprise (53), none (49), smb (45) | mid_market | KEEP | 4 values incl. 'none' (49). Not validated by size (mean employees 3.7k-4.7k in every tier). | Display/segment only; do not rank on it. |

### CRM `contacts` (GET /accounts/:id/contacts)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 730 | con_001 .. con_730 | con_001 | KEEP | Primary key; every email-activity and task contact_id resolves to a contact of the same account. | Link tasks/emails to people. |
| `accountId` (account_id) | TEXT | 0.0 | 200 | acc_001 .. acc_200 | acc_014 | KEEP | FK, all 200 accounts covered. | Grouping. |
| `name` | TEXT | 0.0 | 414 | Alex Brown .. Zoe Wilson | Kai Jones | KEEP | Generated names (414 distinct). | Who to contact. |
| `email` | TEXT | 0.0 | 728 | alex.brown@example.inval .. zoe.wilson@marigoldpartn | kai.jones@sagemedgroup-north.example | CLEAN-THEN-KEEP | 81 (11%) are placeholders @example.invalid (every contact of the 23 no-domain accounts); 2 duplicates. Null them before use. | Contact detail; NOT a join key. |
| `title` | TEXT | 0.0 | 16 | CTO .. VP of Operations | Revenue Cycle Manager | KEEP | 16 clean titles; the reliable role field. | Pick the right person (derive role from title). |

### CRM `activities` (GET /accounts/:id/activities; fields depend on `type`)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 267 | act_001 .. act_267 | act_001 | KEEP | Primary key. | Reference. |
| `accountId` (account_id) | TEXT | 0.0 | 198 | acc_001 .. acc_200 | acc_001 | KEEP | FK. | Grouping. |
| `type` (activity_type) | TEXT | 0.0 | 4 | email (170), stage_change (88), note (5), meeting (4) | email | KEEP | email 170, stage_change 88, note 5, meeting 4; no unknown types (so the API's mapper never throws). | Route to the type-specific fields below. |
| `direction` | TEXT | 36.3 | 2 | outbound (88), inbound (82) | outbound | KEEP | Email only: inbound 82 / outbound 88. | Who touched last (weak signal). |
| `timestamp` | TEXT | 0.0 | 101 | 2023-03-30 .. 2025-03-14 | 2025-02-22 | KEEP | Every CRM timestamp is T08:00:00.000Z, so day granularity only; same-day order is undefined. | Recency, timelines. |
| `contactId / contactIds` (contact_id) | TEXT | 36.3 | 170 | con_009 .. con_728 | con_009 | KEEP | Set on all 170 emails; NULL on all meetings, so meeting contactIds is always [] in the API. | Who was emailed. |
| `outcome` | TEXT | 98.5 | 2 | positive (3), negative (1) | positive | KEEP | 4 meetings: positive acc_004, acc_010, acc_021; negative acc_022. | Signal: meeting outcome (high value, tiny coverage). |
| `from` (from_stage) | TEXT | 67.0 | 2 | prospect (75), evaluation (13) | prospect | DERIVE-ONLY | stage_change only: prospect 75 / evaluation 13. | Stage history; time in stage. |
| `to` (to_stage) | TEXT | 67.0 | 3 | evaluation (48), closed_lost (27), mvp (13) | evaluation | DERIVE-ONLY | Always equals the current account stage; customers and prospects have no stage_change rows. | Stage history; time in stage. |
| `text` | TEXT | 98.1 | 5 | No response since the security review. Next step unclear. (1), Reached out a few times, no deal opened. (1), Lost on pri | No response since the security review. N | KEEP | 5 notes, all meaningful (acc_022 dissatisfaction, acc_001 stalled security review, acc_005 'Lost on price... keep warm', acc_003, acc_017). | Signal: note text (quote verbatim). |

### CRM `opportunities` (GET /accounts/:id/opportunities)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 135 | opp_001 .. opp_135 | opp_001 | KEEP | Primary key. | Reference. |
| `accountId` (account_id) | TEXT | 0.0 | 135 | acc_001 .. acc_200 | acc_001 | KEEP | FK; 135 distinct accounts (none for 27 closed_lost, 35 prospects, 3 customers). | Grouping. |
| `name` | TEXT | 0.0 | 129 | Enterprise license .. Renewal - willowjoint | Enterprise license | KEEP | Deal type: 'Renewal - x' (67), Expansion, Enterprise license, Initial contract, Master agreement... | Classify deal (renewal vs expansion vs new). |
| `stage` | TEXT | 0.0 | 3 | closed_won (67), evaluation (53), mvp (15) | evaluation | KEEP | closed_won 67, evaluation 53, mvp 15. | Pipeline stage. |
| `value` | REAL | 0.0 | 134 | 20538.0 .. 1024463.0 | 108312.0 | KEEP | $20.5k-$1.02M; open pipeline $13.3M. | Signal: open value at stake. |
| `openedAt` (opened_at) | TEXT | 0.0 | 79 | 2024-10-30 .. 2025-03-09 | 2024-12-24 | KEEP | 2024-10-30..2025-03-09. 18 opps report a stage change before they were opened. | Deal age. |
| `closeDate` (close_date) | TEXT | 0.0 | 88 | 2025-03-30 .. 2025-09-29 | 2025-06-12 | KEEP | Open: expected close (7 within 30 days). Won: future date 2025-03-30..09-29, read as the renewal date; differs from contracts.ending_before (median 77 days apart). | Signal: days to close / renewal. |
| `lastStageChangeAt` (last_stage_change_at) | TEXT | 0.0 | 51 | 2025-01-13 .. 2025-03-12 | 2025-01-28 | CLEAN-THEN-KEEP | Never equals the stage_change activity date (0/61) and precedes openedAt on 18 opps; treat as approximate. | Days in stage (open opps 2-45 days). |
| `nextStep` (next_step) | TEXT | 1.5 | 20 | Approve expansion .. Send proposal | Close executive buy-in | KEEP | 20 templated phrases; same text as account nextStep. | Context. |
| `status` | TEXT | 0.0 | 2 | open (68), won (67) | open | KEEP | open 68 / won 67. | Separate open pipeline from renewals. |

### CRM `tasks` (GET /accounts/:id/tasks)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 274 | tsk_001 .. tsk_274 | tsk_001 | KEEP | Primary key. | Reference. |
| `accountId` (account_id) | TEXT | 0.0 | 136 | acc_002 .. acc_200 | acc_014 | KEEP | FK. | Grouping. |
| `contactId` (contact_id) | TEXT | 0.0 | 218 | con_001 .. con_730 | con_004 | KEEP | All 274 resolve to a contact of the same account. | Who the task is about. |
| `ownerId` (owner_id) | TEXT | 0.0 | 10 | alex.rivera .. tom.wright | david.okafor | KEEP | Equals the account owner on 274/274. | Consistency check only. |
| `title` | TEXT | 0.0 | 8 | Follow up on evaluation feedback (40), Resolve open support ticket (39), Confirm go-live date (36), Renewal conversation | Confirm go-live date | KEEP | 8 templates (renewal prep, support ticket, security review...). | Context: what is open. |
| `dueDate` (due_date) | TEXT | 0.0 | 21 | 2025-02-22 .. 2025-03-14 | 2025-03-04 | KEEP | 2025-02-22..2025-03-14; none in the future; 152 of 161 open tasks overdue, 9 due today. | Overdue count (weak, flags 98 accounts). |
| `completed` | INTEGER | 0.0 | 2 | 0 (161), 1 (113) | 0 | KEEP | 113 done / 161 open (API maps 1 -> true). | Open-task filter. |
| `createdAt` (created_at) | TEXT | 0.0 | 36 | 2025-02-02 .. 2025-03-09 | 2025-02-26 | DERIVE-ONLY | 2025-02-02..03-09; 32 tasks are due before they were created. | Task age only. |

### Analytics `customers`

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 207 | cust_001 .. cust_207 | cust_001 | KEEP | Primary key; FK of every analytics table. | Join target (cust_ -> acc_). |
| `customer_name` | TEXT | 0.0 | 202 | acmepathology-prod .. windsorpartners-prod | hearthpediatrics-prod | CLEAN-THEN-KEEP | Strip env suffixes (-prod, prod, -cloud, -trial, -us, -eu, -sandbox, -holdings, -health-group); 5 names occur twice. | Join key #3 (name). |
| `billing_email` | TEXT | 0.0 | 202 | accounts@brightregional. .. us@crestlinechild.exampl | billing@hearthpediatrics.example | CLEAN-THEN-KEEP | 100% populated, always @<stem>.example; local part is a role mailbox. | Join key #2 (billing domain) - used for 24 accounts. |
| `domain` | TEXT | 15.0 | 169 | acmepathology .. windsorfamily | hearthpediatrics | CLEAN-THEN-KEEP | 31 null (15%); 170 bare stems without TLD, 6 '<stem>customers.example'. | Join key #1 (domain) - used for 140 accounts. |
| `region` | TEXT | 10.1 | 3 | apac (66), emea (65), amer (55) | amer | KEEP | amer/emea/apac; NULL for cust_001-021. CRM has no region, so it cannot disambiguate. | Context; regional split for 1:N accounts. |
| `created_at` | TEXT | 0.0 | 180 | 2023-04-16 .. 2025-01-13 | 2025-01-04 | DERIVE-ONLY | For all 7 tenants created inside the usage window, first usage = created_at exactly, so it is a reliable tenant start date. | Signal: tenant started recently (onboarding). |

### Analytics `projects`

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 415 | proj_001 .. proj_415 | proj_001 | KEEP | Primary key. | Join usage to project class. |
| `customer_id` | TEXT | 0.0 | 207 | cust_001 .. cust_207 | cust_001 | KEEP | FK; always equals the customer on the project's usage events. | Grouping. |
| `name` | TEXT | 0.0 | 414 | acmepathology-qa .. windsorpartners-sandbox | hearthpediatrics-prod | CLEAN-THEN-KEEP | Suffix gives the environment: staging/qa/internal/sandbox/test/trial/eval (+digits) = non-prod (202 of 415). | Project classifier -> production-only usage. |
| `environment_type` | TEXT | 0.0 | 2 | PRODUCTION (411), SANDBOX (4) | PRODUCTION | CLEAN-THEN-KEEP | SANDBOX label is right for the 4 SANDBOX projects, but 198 non-prod-named projects are labelled PRODUCTION (49.8% of PRODUCTION request volume). | Combine with name class; SANDBOX = pre-customer trial. |

### Analytics `usage_events` (use via aggregates; one scan is ~30 s)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `customer_id` | TEXT | 0.0 | 207 | cust_001 .. cust_207 | cust_001 | KEEP | 207 customers. | Grouping/join. |
| `project_id` | TEXT | 0.0 | 415 | proj_001 .. proj_415 | proj_001 | KEEP | 415 projects; customer always matches the project's customer. | Project class (prod vs non-prod). |
| `event_type` | TEXT | 0.0 | 3 | request (1,329,689), tokens (676,174), transcribe (175,235) | request | KEEP | request 1.33M rows, tokens 676k, transcribe 175k. | Separate metrics. |
| `event_date` | TEXT | 0.0 | 90 | 2024-12-15 .. 2025-03-14 (90 days) | 2025-01-04 | KEEP | 90 days; weekday volume about 2.5x weekend, so compare 7-day-aligned windows. | Trend windows. |
| `quantity` | REAL | 0.0 |  | request = 1.0 (1 distinct); tokens 155.54..44,595.72 (>200k distinct); transcribe 0.41..34.97 (3,435 distinct) | 1.0 | KEEP | request always 1.0; tokens 156-44,596 (mean 11,384); transcribe 0.41-34.97 (mean 14.0, unit not documented). | Volume metrics. |
| `is_nfr` | INTEGER | 0.0 | 2 | 0 (2,137,323), 1 (43,775) | 0 | KEEP | 2.01% of rows (0-3.3% per customer), independent of all other columns. | Filter: exclude is_nfr=1. |

### Analytics `contracts`

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 129 | contract_001 .. contract_129 | contract_001 | KEEP | Primary key. | Reference. |
| `customer_id` | TEXT | 0.0 | 129 | cust_001 .. cust_207 | cust_001 | KEEP | 129 distinct customers (incl. all 8 unmatched ones). | Join to account. |
| `type` | TEXT | 0.0 | 3 | credit (50), prepaid (45), postpaid (34) | credit | KEEP | credit 50 / prepaid 45 / postpaid 34. | Which low-balance threshold applies. |
| `amount` | REAL | 0.0 | 129 | 9852.0 .. 243830.0 | 22370.0 | KEEP | 9,852-243,830 (total 14.9M). | Contract size; balance %. |
| `balance` | REAL | 0.0 | 129 | 4600.0 .. 222822.0 | 10371.0 | KEEP | Balance 11%-98% of amount (median 52%). Implied burn does not track usage (r = -0.04) or elapsed term (r = 0.08). | Signal: balance %, runway (low confidence). |
| `starting_at` | TEXT | 0.0 | 106 | 2024-05-22 .. 2025-02-09 | 2024-05-31 | KEEP | 2024-05-22..2025-02-09. | Elapsed days for burn rate. |
| `ending_before` | TEXT | 0.0 | 105 | 2025-04-14 .. 2026-01-08 | 2025-06-03 | KEEP | 2025-04-14..2026-01-08 (31-300 days out; 21 of 129 within 90 days, 12 within 60). | Signal: days to contract end. |

### Analytics `alerts` (thresholds only)

| Column | Type | Null % | Distinct | Range / top values | Sample | Verdict | Why | Used for |
|---|---|---|---|---|---|---|---|---|
| `id` | TEXT | 0.0 | 3 | alert_low_balance (1), alert_credit_low (1), alert_usage_spike (1) | alert_low_balance | DERIVE-ONLY | alert_low_balance / alert_credit_low / alert_usage_spike. | Reference. |
| `name` | TEXT | 0.0 | 3 | Low committed balance (1), Low credit balance (1), Usage spike (1) | Low committed balance | DERIVE-ONLY | Human label. | Display when explaining a recomputed alert. |
| `alert_type` | TEXT | 0.0 | 3 | low_remaining_commit_balance_reached (1), low_credit_balance_reached (1), usage_spike_detected (1) | low_remaining_commit_balance_reached | DERIVE-ONLY | low_remaining_commit_balance_reached / low_credit_balance_reached / usage_spike_detected. | Map to contract type. |
| `threshold` | REAL | 0.0 | 3 | 0.2 (1), 0.15 (1), 2.0 (1) | 0.2 | DERIVE-ONLY | 0.20 commit, 0.15 credit, 2.0 spike. | Recompute low-balance flag: <=0.15 credit/postpaid, <=0.20 prepaid. |

## 3. Derived signals

Counts are out of 200 accounts (184 resolvable without ambiguity). Usage windows are rolling and anchored on the reference date: **L28 = 2025-02-15..03-14, P28 = 2025-01-18..02-14**. Every 7-day block holds 5 weekdays and 2 weekend days, which matters because weekday volume is about 2.5x weekend. NFR rows (2%) are excluded. "Prod" means the project name is not staging/qa/internal/sandbox/test/trial/eval (with optional digits).

| Signal | Definition | Accounts flagged | Separates accounts? | Caveat |
|---|---|---|---|---|
| **Prod request trend** | L28 vs P28 requests on prod-named projects; growing >= +15%, declining <= -15%; only called if P28 >= 100 | 31 growing, 20 declining (78 flat, 5 low volume, 50 no prod usage) | **Yes.** The distribution is trimodal. Calendar weeks (wk8-11 vs wk4-7) give the same class for 143/146 | Book baseline is +3.9%. Trends are per project, so a 1:N account can hide opposite stories |
| **Name-classifier impact** | Same trend, trusting `environment_type` instead of names | Class changes for 66 (44 lose all prod usage); trend moves >10 pp for 34 | Material | The data can't prove the names right. Show both numbers when they differ |
| **Tokens/transcribe agree?** | Same windows and cut on tokens and transcribe | All three agree on 94 of 129; tokens on 117 (r = 0.88); transcribe on 100 (r = 0.69) | As a confidence modifier | Transcribe volumes are small and noisy |
| **Contract balance and runway** | balance/amount; linear burn since `starting_at`; projected exhaustion vs `ending_before`; low = <= 15% credit/postpaid, <= 20% prepaid | 114 have a contract: 10 low balance, 29 run out within 60 days, 65 run out before term end | Low balance and the 60-day cut, yes; "before term end" is too broad (57%) | Balance doesn't track usage (burn vs requests r = -0.04), so the runway is an assumption |
| **Days to contract end / renewal** | `ending_before` - today; won-opp `closeDate` - today | Contract ends within 60 days: 10 (17 within 90); won-opp date within 60 days: 11 | Yes | The two dates disagree (median 77 days apart) |
| **New projects (30 d)** | `projects.created_at` >= 02-12, or first usage >= 02-12 | 25 by created_at; 1 by first usage (acc_005) | No, as defined | Usage predates `created_at` on all 121 projects created inside the window |
| **Tenant started recently** | `customers.created_at` (= first usage) inside the window; or a dormant tenant waking up | 7: acc_001, 036, 109, 151, 182, 188 onboarding; acc_005 reactivated | Yes, specific | These are the only >= 2x ramps in the data; the spike alert never fired |
| **API keys new / inactive** | Keys created in the last 30 d; `active` = 0 | 77 / 85 of 184 | **No.** Same rate on growing, flat and declining accounts | Table dropped |
| **Pre-customer sandbox** | SANDBOX-labelled usage on a prospect/evaluation/mvp account | 3: acc_002 ($742k), acc_006 ($87k), acc_008 ($1.02M); 27 if name-based | Label version, yes | cust_006 and cust_008 also hold contracts |
| **Usage on prospect / closed_lost** | Prod usage in L28 > 0 | 28 prospects, 20 closed_lost; 12 of them growing; 1 reactivated | Only the growing subset | Every matched tenant is active daily |
| **Days since CRM contact** | today - `lastContactAt` | 54 of the 138 customer/evaluation/mvp accounts are > 14 days | Moderate; use as a tiebreaker | Customers max out at 20 days; closed_lost are 45-298 |
| **Meeting outcome / note text** | Latest meeting `outcome`; note `text` | 3 positive, 1 negative meeting; 5 notes (8 accounts) | Yes, but tiny coverage | Meetings have no attendees (`contactIds` is always []) |
| **Open opp value and close date** | `status`=open; `closeDate` - today | 68 open ($13.3M); 18 close within 45 days ($5.19M) | Yes | Don't use `account.opportunityAmount`; it also carries won renewals |
| **Stage vs reality** | Stage contradicted by contract or usage | Prospect with contract 21; closed_lost with contract 11; customer without contract 28; customer without prod usage 19 | Weak on its own | Contract presence doesn't depend on stage (62% of prospects vs 59% of customers) |
| **Declining near renewal** | Declining customer, renewal or contract end within 75 days | 5: acc_009, 022, 023, 127, 187 | Yes | acc_022 also has the only negative meeting |
| **Big deal, low engagement** | Open opp >= $500k and < 500 requests in 90 days | 2: acc_002, acc_008 | Yes | Both are sandbox trials |
| **Regional divergence** | 1:N tenants trending in different directions | 1: acc_011 (US +53%, EU -23%; the total, +13%, looks flat) | Yes | Report per region |
| **Overdue tasks** | Open and `dueDate` < today | 98 | Weak (49%) | 152/161 open tasks are overdue; none are due in the future |
| **Unmatched tenants** | Analytics customers with no CRM account | 8 tenants, $964k of contracts | n/a | Outside the 200-account book; CRM hygiene |

Signals tested and dropped: **last-week vs prior-3-weeks** (no flat account moved 20% or more), **usage-dimension mix or breadth** (see DROP), **API keys**, and **alert history**.

Core logic (SQLite). In the tool, compute these once into a cache; don't scan per question:

```sql
WITH proj AS (SELECT id, CASE WHEN name LIKE '%-staging%' OR name LIKE '%-qa%' OR name LIKE '%-internal%' OR name LIKE '%-sandbox%'
                        OR name LIKE '%-test%' OR name LIKE '%-trial%' OR name LIKE '%-eval%' THEN 'nonprod' ELSE 'prod' END cls FROM projects)
SELECT u.customer_id, u.event_type,
       SUM(CASE WHEN u.event_date BETWEEN '2025-02-15' AND '2025-03-14' THEN u.quantity ELSE 0 END) AS l28,
       SUM(CASE WHEN u.event_date BETWEEN '2025-01-18' AND '2025-02-14' THEN u.quantity ELSE 0 END) AS p28
FROM usage_events u JOIN proj p ON p.id = u.project_id
WHERE u.is_nfr = 0 AND p.cls = 'prod'          -- no prod-named project is SANDBOX-labelled
GROUP BY 1, 2;                                  -- change = l28/p28 - 1; sum over the account's matched customers

SELECT customer_id, type, balance / amount AS balance_pct,
       (amount - balance) / (julianday('2025-03-14') - julianday(substr(starting_at, 1, 10))) AS burn_per_day,   -- linear assumption
       julianday(substr(ending_before, 1, 10)) - julianday('2025-03-14') AS days_to_end
FROM contracts;
```

## 4. Join notes

There is no shared key: `customers.external_id` is a unique `synthetic_customer_N` with no CRM counterpart. Normalisation:

- **CRM:** name in lowercase, drop `Group|LLC|Ltd|Inc|Healthcare` and ` - North/West`, keep `[a-z0-9]`; domain with `.example` and punctuation removed.
- **Analytics:** `customer_name` with `-prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group` removed; `domain` with `.example` and a trailing `customers` removed; the domain of `billing_email`.
- An account and a customer are candidates if any key is equal. Confidence: **domain** > **billing_domain** > **name_only** > **ambiguous** (a connected group with more than one account, or more than one customer, unless it is one account with N regional tenants).

| Confidence | Accounts | Detail |
|---|---|---|
| domain | 140 | Of 141 customer links: 71 literal, 64 needed hyphen removal (`cornerstone-clinical` = `cornerstoneclinical`), 6 needed the `customers` suffix stripped. Includes acc_011 -> cust_011 (us) + cust_012 (eu) |
| billing_domain | 24 | Customer domain NULL; billing-email domain matches (11 literal, 13 after normalisation) |
| name_only | 20 | 19 CRM accounts have no domain; acc_016 has a domain but its tenant bills from `pinnacleoutpatientold.example` |
| ambiguous | 16 | 7 same-name clusters (below); usage fields are left empty in the preview |
| none | 0 | All 200 accounts have at least one candidate. 8 analytics tenants (cust_200-207) have no account |

| Cluster | CRM accounts (stage) | Analytics customers | Why it matters | id-order hint* |
|---|---|---|---|---|
| LakeviewMen | acc_010 (eval, $139k, positive meeting 03-14), acc_047 (eval, $369k) | cust_010 (+44%, no contract), cust_046 (+40%, credit 32% left) | Both growing; contract on one | acc_010:cust_010, acc_047:cust_046 |
| SageMedGroup | acc_013 (customer, master agreement $372k), acc_014 North, acc_015 West (branches, no opp), acc_062 (eval, $214k) | cust_014 `holdings` (entity-a/b projects, +38%), cust_061 (qa project only) | Semantic hint: holdings = parent + 2 branches | acc_013/014/015:cust_014, acc_062:cust_061 |
| PrairieAmbulatory | acc_020 (customer, $144k expansion), acc_146 (customer, no domain) | cust_019 (+48%), cust_145 (flat, credit 44% left) | Growth vs flat | acc_020:cust_019, acc_146:cust_145 |
| TrinityRehabilitation | acc_028 (closed_lost), acc_125 (eval, $255k) | cust_027 (-23%), cust_124 (flat) | Decline on a lost or a live deal? | acc_028:cust_027, acc_125:cust_124 |
| VeridianSleep | acc_064 (customer, $299k renewal), acc_137 (closed_lost) | cust_063 (flat, no contract), cust_136 (+34%, prepaid) | Opposite stories | acc_064:cust_063, acc_137:cust_136 |
| CrestlineSenior | acc_069 (customer), acc_152 (customer, no domain) | cust_068 (+42%), cust_151 (flat) | Growth vs flat | acc_069:cust_068, acc_152:cust_151 |
| WindsorFamily | acc_161 (closed_lost), acc_185 (prospect) | cust_160 (flat), cust_184 (flat, postpaid) | Contract on one | acc_161:cust_160, acc_185:cust_184 |

**Disambiguators tested, none work:** the `created_at` gap between account and customer (random, -638..+769 days); `region` (the CRM has none); `owner_email` (role mailboxes like `owner@`); stage vs contract presence (independent); contract `ending_before` vs opp `closeDate` (median 77 days apart); opp value vs contract amount (r = 0.12).

\* **Generator artefact, not a key:** the ids are aligned by position. acc_N = cust_N for N <= 10; acc_011 = cust_011 + cust_012; acc_012/013 = cust_013/014; acc_014/015 have no tenant; acc_N = cust_(N-1) for N >= 16. All **183/183** unambiguous matches agree with this pattern, which validates the name/domain join (no false matches). It also implies the pairs in the last column. Use it to test the join, never as a production rule. In the tool, show both candidates and let the AE confirm.

## 5. Dropped fields

| Column | Why dropped |
|---|---|
| accounts.`updatedAt` (updated_at) | Equals lastContactAt on 181/200 accounts; carries no extra information. |
| accounts.`opportunityAmount` (opportunity_amount) | Exact mirror of opportunities.value (135/135), including 67 closed-won renewals, so it is not the 'open value' the docs describe. |
| accounts.`closeDate` (close_date) | Exact mirror of opportunities.close_date (135/135); for won opps it is a future date, so its meaning depends on status. |
| contacts.`persona` | Only executive/clinical/operations/technical (docs' champion/economic_buyer never occur). Technical titles always map to 'technical', the other 11 titles are spread at random over the other three. |
| contacts.`lastContactedAt` (last_contacted_at) | Copied from the account's lastContactAt for 730/730 contacts. |
| activities.`subject` | Two templates, fully determined by direction ('Quick update on the evaluation' = outbound, 'Re: follow up on the pilot' = inbound), even on customer accounts. |
| opportunities.`ownerId` (owner_id) | Differs from the account owner on 112/135 opps; the account owner is the one consistent with tasks. |
| tasks.`description` | 100% NULL. |
| customers.`external_id` | Unique 'synthetic_customer_N', no counterpart in the CRM. |
| customers.`owner_email` | Role mailbox (owner@ on 186/207), not a person; nothing to compare in the CRM. |
| customers.`environment_type` | 206 PRODUCTION / 1 SANDBOX; trial tenants cust_002 and cust_008 are labelled PRODUCTION. Project label + name is better. |
| customers.`archived_at` | 100% NULL. |
| projects.`created_at` | Usage predates created_at on 121/121 projects created inside the window (e.g. ironwoodhealth-new 'created' 2025-02-27, used since 2024-12-15). |
| projects.`last_active_at` | Constant 2025-03-14T08:00Z on all 415 rows. |
| usage_events.`id` | Row id ue_0000001..ue_2181098. |
| usage_events.`environment_type` | Always equals the project's environment_type (denormalised copy) - same unreliability. |
| usage_events.`model_name` | 6 values drawn from a fixed per-event-type mix; every customer uses all 6; no customer/time signal. |
| usage_events.`route` | 7 values, per-event-type mix; every customer uses all 7; no signal. |
| usage_events.`agent_used` | 4 agents + 15% empty, per-event-type mix; every customer uses all; no signal. |
| usage_events.`language_used` | 7 languages + 40% empty (always empty on tokens); every customer uses all; no signal. |
| usage_events.`source` | 4 values, per-event-type mix; every customer uses all 4; no signal. |
| api_keys.`id` | Row id. |
| api_keys.`customer_id` | FK (all 207 customers have keys). |
| api_keys.`project_id` | 100% NULL. |
| api_keys.`label` | Sequence credential-1..14 per customer. |
| api_keys.`environment_type` | 785 PRODUCTION / 4 SANDBOX, mirrors the customer. |
| api_keys.`created_at` | 96 keys (12%) were last used before they were created. |
| api_keys.`last_used_at` | Customer max(last_used_at) is before 2025-03-14 for 161/207 tenants despite daily usage. |
| api_keys.`active` | Just a recency flag: all 137 inactive keys were last used before 2025-02-12 and all 652 active keys after it. No deactivation date. |
| contracts.`name` | Junk: '<random word> <type> product'; the second word always equals type. |
| customer_alert_history.`id` | Row id. |
| customer_alert_history.`customer_id` | 35 customers. |
| customer_alert_history.`alert_id` | credit_low 24 (14 credit + 10 postpaid contracts), low_balance 11 (prepaid). |
| customer_alert_history.`alert_status` | Constant 'triggered'. |
| customer_alert_history.`created_at` | 2025-02-22..2025-03-13. |

Usage dimensions in detail: each one is drawn from a fixed mix per `event_type` (language is always empty on tokens; transcribe models only appear on transcribe events). Within an event type, though, they don't depend on customer or time. Per customer, a chi-square test against the global mix gives p < 0.05 for 9-14 of 207 customers (about 10 expected by chance). A shift between the first and last 4 full weeks shows up for 7-12 of 202 (also chance level), and every customer uses every value.

## 6. Corrections to earlier findings

- CrestlineChild (acc_011 -> cust_011 us + cust_012 eu) is not ambiguous: both tenants point only to acc_011, so it is a clean 1:2 map. But the regions diverge (US +53%, EU -23%) and the sum (+13%) looks flat, so report per region.
- The 7 duplicate clusters cannot be separated with legitimate fields (created_at, region, owner_email, contracts, opp dates/amounts all tested). Only the generator's ordinal id pattern separates them, which is an artefact.
- environment_type: 49.8% of PRODUCTION-labelled request volume (50.6% tokens, 49.8% transcribe) comes from non-prod-named projects - but the names are staging/qa/internal/sandbox(+2/3). The single '-test' project is SANDBOX-labelled, and 18 of 19 '-sandbox' projects are labelled PRODUCTION. Prod- and non-prod-named projects have the same volume and trend distributions, so the name rule is a business assumption the data cannot confirm.
- Sandbox-only tenants cust_002/006/008 -> acc_002/006/008 holds. Nuance: only their projects (and cust_006's customer row) say SANDBOX; cust_006 and cust_008 also have credit contracts ($117.9k, $232.5k) and fired credit_low alerts.
- Alert history: '~23 fired with >50% balance' is exactly 23/35. Stronger: only 1 of 35 (cust_040, 16.8% vs 0.20) fired at or below its threshold; 9 customers at/below threshold never fired; credit_low also fires on 10 postpaid contracts; usage_spike never fired.
- Persona vs title: technical titles always map to 'technical'. Only the 11 non-technical titles get a random executive/clinical/operations persona.
- Activities: 198 accounts have 1-3, but acc_014 and acc_015 have none. The 2 email subjects are fully determined by direction.
- Tasks: 152/161 open tasks overdue holds; the other 9 are due today, and no task in the CRM is due after 2025-03-14.
- Account opportunityAmount/closeDate mirror the opp (135/135, plus nextStep 135/135). They mirror won renewals too, so opportunityAmount is not 'open value' as the docs say.
- Usage dimensions are not uniform: each follows a fixed per-event-type mix (e.g. language always empty on tokens; transcribe models only on transcribe). Within event type they are independent of customer and time, so DROP stands.
- Constant/empty columns all confirmed. Additions: tasks.description 100% NULL, alert_status constant, and projects.created_at is contradicted by usage on every in-window project.
- 'Usage on closed_lost/prospect accounts' is universal (every matched tenant has daily usage), so on its own it is not a signal. Only the growing subset (12 accounts) or reactivation (acc_005) is.
- Confirmed as stated: no shared key; all 200 accounts get a candidate; the duplicate lists; cust_200-207 unmatched; opp owner differs from account owner on 112/135; contact `lastContactedAt` copied 730/730; `is_nfr` is 2.01%; the lowest balances (cust_129 11.0%, cust_126 12.4%, cust_007 12.5%) never fired an alert.

## 7. Assumptions and caveats

- Reference date 2025-03-14 ('today'). Windows are rolling 7-day weeks anchored on it (L28 = 02-15..03-14, P28 = 01-18..02-14), which avoids the 6-day partial week and the 2.5x weekday/weekend effect.
- NFR events (2%) excluded from all usage metrics.
- Project environment = name-based rule (staging|qa|internal|sandbox|test|trial|eval + optional digits = non-prod). Shown alongside the label-based number where they differ.
- Contract balance does not reconcile with usage; runway/exhaustion uses linear burn since starting_at and is an assumption.
- Low-balance thresholds: 0.15 for credit and postpaid, 0.20 for prepaid, inferred from which alert the history attaches to each contract type.
- CRM was profiled from SQLite directly. The tool must use the HTTP API: missing values come back as null (not absent); meeting contactIds is always []; type-specific fields only appear on their activity type; opportunities need one call per account.
- All timestamps in both sources are 08:00:00.000Z, so day granularity only.
- The 16 ambiguous accounts have no usage fields in the preview, by design. The 8 unmatched tenants are outside the preview.
- Flags are independent booleans, not a score; counts are of the 200 accounts (184 resolvable).
- Synthetic data: tenants cust_001-021 (region NULL) carry the hand-made stories (special project names, notes, meetings). The rest look randomly generated, so don't overfit thresholds to them.

## 8. Files

- [`exploration/data_inventory.json`](exploration/data_inventory.json): every table and column with verdict, reason and use; signals; join; corrections; caveats.
- [`exploration/account_preview.csv`](exploration/account_preview.csv): 200 rows, one per CRM account. Groups of columns: identity and CRM context; match (`match_confidence`, `matched_customer_ids`, `candidate_customer_ids`, `cluster_id`, `candidates_summary`); usage (prod L28/P28, trend % and class, tokens/transcribe trends, agreement, label-based trend, non-prod share, 12-week series); contract (type, balance %, end, burn, projected exhaustion, low balance); CRM (last contact, open/won opp, tasks, last meeting, latest note); `flags` (pipe-separated booleans from section 3, not a score). Built only from KEEP/CLEAN-THEN-KEEP/DERIVE-ONLY columns: nothing from `api_keys`, alert history or `projects.created_at`.
- [`exploration/scripts/`](exploration/scripts/) (read-only Python profiling, run with `python -I <script> <db>`): `build_agg.py` (one pass over usage_events into `work\agg.sqlite`), `usage_metrics.py`, `joinlib.py`, `build_preview.py`, `assemble_inventory.py`, `render_md.py`, plus the probe scripts used to verify each claim.
