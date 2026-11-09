"""Assemble data_inventory.json from the column profiles, the preview stats and hand-written verdicts.
Usage: python -I assemble_inventory.py <work_dir> <out_json>"""
import json, sys, os, collections
W, OUT = sys.argv[1], sys.argv[2]
crm = json.load(open(os.path.join(W, "crm_profile.json")))
an = json.load(open(os.path.join(W, "an_profile.json")))
up = json.load(open(os.path.join(W, "usage_profile.json")))
st = json.load(open(os.path.join(W, "preview_stats.json")))

K, C, D, X = "KEEP", "CLEAN-THEN-KEEP", "DERIVE-ONLY", "DROP"
# (api_name, verdict, reason, use)
V = {
("crm", "accounts"): (K, "Core commercial record, one row per account (200). Mostly clean; two mirrored opportunity fields and updated_at are redundant.", {
 "id": ("id", K, "Primary key and API path parameter.", "Key for every CRM call; preview row id."),
 "name": ("name", C, "Display name; needs normalising for the join (drop Group/LLC/Ltd/Inc/Healthcare and ' - North/West', strip punctuation). 2 exact duplicate names and 7 duplicate-name clusters.", "Join key #3 (name) to customers.customer_name; display."),
 "domain": ("domain", C, "Best join key but 23 null (11.5%); strip '.example' and hyphens (64 of 141 domain links needed hyphen removal). 3 domains are shared by two accounts.", "Join key #1 (domain) and #2 (vs billing-email domain)."),
 "industry": ("industry", K, "9 clean values (one generic 'Healthcare').", "Context/filters only."),
 "employee_count": ("employeeCount", K, "Populated 100%; plausible range. Not related to icpTier.", "Context (size)."),
 "owner_id": ("ownerId", K, "10 owners; consistent with task owners (274/274).", "Who owns the account; book filter."),
 "stage": ("stage", K, "5 values; consistent with stage_change activities (to_stage = stage on all 88) and opportunity stages.", "Commercial state; base for stage-vs-reality checks."),
 "created_at": ("createdAt", D, "Valid dates, but gap to customers.created_at is random (-638..+769 days), so it does not help disambiguate.", "Account age only."),
 "updated_at": ("updatedAt", X, "Equals lastContactAt on 181/200 accounts; carries no extra information.", "None."),
 "last_contact_at": ("lastContactAt", K, "Matches the latest email/meeting/note on 158 of 172 accounts that have one; the only trustworthy recency field.", "Signal: days since last CRM contact."),
 "next_step": ("nextStep", K, "23 templated phrases; identical to the opportunity nextStep on all 135 accounts with an opp; null for all prospects/closed_lost.", "Context in answers ('next step: Send proposal')."),
 "opportunity_amount": ("opportunityAmount", X, "Exact mirror of opportunities.value (135/135), including 67 closed-won renewals, so it is not the 'open value' the docs describe.", "None; use /opportunities value + status."),
 "close_date": ("closeDate", X, "Exact mirror of opportunities.close_date (135/135); for won opps it is a future date, so its meaning depends on status.", "None; use /opportunities closeDate + status."),
 "icp_tier": ("icpTier", K, "4 values incl. 'none' (49). Not validated by size (mean employees 3.7k-4.7k in every tier).", "Display/segment only; do not rank on it."),
}),
("crm", "contacts"): (C, "730 contacts (1-7 per account). Names/titles usable; persona is noisy, emails of no-domain accounts are placeholders, and last_contacted_at is a copy.", {
 "id": ("id", K, "Primary key; every email-activity and task contact_id resolves to a contact of the same account.", "Link tasks/emails to people."),
 "account_id": ("accountId", K, "FK, all 200 accounts covered.", "Grouping."),
 "name": ("name", K, "Generated names (414 distinct).", "Who to contact."),
 "email": ("email", C, "81 (11%) are placeholders @example.invalid (every contact of the 23 no-domain accounts); 2 duplicates. Null them before use.", "Contact detail; NOT a join key."),
 "title": ("title", K, "16 clean titles; the reliable role field.", "Pick the right person (derive role from title)."),
 "persona": ("persona", X, "Only executive/clinical/operations/technical (docs' champion/economic_buyer never occur). Technical titles always map to 'technical', the other 11 titles are spread at random over the other three.", "None; derive role from title."),
 "last_contacted_at": ("lastContactedAt", X, "Copied from the account's lastContactAt for 730/730 contacts.", "None."),
}),
("crm", "activities"): (K, "267 rows; 198 accounts have 1-3 activities, 2 have none. Sparse and templated, but the 4 meetings and 5 notes are the only qualitative signal in the CRM.", {
 "id": ("id", K, "Primary key.", "Reference."),
 "account_id": ("accountId", K, "FK.", "Grouping."),
 "activity_type": ("type", K, "email 170, stage_change 88, note 5, meeting 4; no unknown types (so the API's mapper never throws).", "Route to the type-specific fields below."),
 "direction": ("direction", K, "Email only: inbound 82 / outbound 88.", "Who touched last (weak signal)."),
 "timestamp": ("timestamp", K, "Every CRM timestamp is T08:00:00.000Z, so day granularity only; same-day order is undefined.", "Recency, timelines."),
 "contact_id": ("contactId / contactIds", K, "Set on all 170 emails; NULL on all meetings, so meeting contactIds is always [] in the API.", "Who was emailed."),
 "subject": ("subject", X, "Two templates, fully determined by direction ('Quick update on the evaluation' = outbound, 'Re: follow up on the pilot' = inbound), even on customer accounts.", "None."),
 "outcome": ("outcome", K, "4 meetings: positive acc_004, acc_010, acc_021; negative acc_022.", "Signal: meeting outcome (high value, tiny coverage)."),
 "from_stage": ("from", D, "stage_change only: prospect 75 / evaluation 13.", "Stage history; time in stage."),
 "to_stage": ("to", D, "Always equals the current account stage; customers and prospects have no stage_change rows.", "Stage history; time in stage."),
 "text": ("text", K, "5 notes, all meaningful (acc_022 dissatisfaction, acc_001 stalled security review, acc_005 'Lost on price... keep warm', acc_003, acc_017).", "Signal: note text (quote verbatim)."),
}),
("crm", "opportunities"): (K, "135 opps, exactly one per account that has one (open 68 / won 67, no lost). Clean apart from owner and stage-change dates.", {
 "id": ("id", K, "Primary key.", "Reference."),
 "account_id": ("accountId", K, "FK; 135 distinct accounts (none for 27 closed_lost, 35 prospects, 3 customers).", "Grouping."),
 "name": ("name", K, "Deal type: 'Renewal - x' (67), Expansion, Enterprise license, Initial contract, Master agreement...", "Classify deal (renewal vs expansion vs new)."),
 "stage": ("stage", K, "closed_won 67, evaluation 53, mvp 15.", "Pipeline stage."),
 "value": ("value", K, "$20.5k-$1.02M; open pipeline $13.3M.", "Signal: open value at stake."),
 "opened_at": ("openedAt", K, "2024-10-30..2025-03-09. 18 opps report a stage change before they were opened.", "Deal age."),
 "close_date": ("closeDate", K, "Open: expected close (7 within 30 days). Won: future date 2025-03-30..09-29, read as the renewal date; differs from contracts.ending_before (median 77 days apart).", "Signal: days to close / renewal."),
 "last_stage_change_at": ("lastStageChangeAt", C, "Never equals the stage_change activity date (0/61) and precedes openedAt on 18 opps; treat as approximate.", "Days in stage (open opps 2-45 days)."),
 "next_step": ("nextStep", K, "20 templated phrases; same text as account nextStep.", "Context."),
 "owner_id": ("ownerId", X, "Differs from the account owner on 112/135 opps; the account owner is the one consistent with tasks.", "None (show account owner)."),
 "status": ("status", K, "open 68 / won 67.", "Separate open pipeline from renewals."),
}),
("crm", "tasks"): (K, "274 tasks on 136 accounts. Structurally clean but every task is due on or before today, so 'overdue' is the norm.", {
 "id": ("id", K, "Primary key.", "Reference."),
 "account_id": ("accountId", K, "FK.", "Grouping."),
 "contact_id": ("contactId", K, "All 274 resolve to a contact of the same account.", "Who the task is about."),
 "owner_id": ("ownerId", K, "Equals the account owner on 274/274.", "Consistency check only."),
 "title": ("title", K, "8 templates (renewal prep, support ticket, security review...).", "Context: what is open."),
 "description": ("description", X, "100% NULL.", "None."),
 "due_date": ("dueDate", K, "2025-02-22..2025-03-14; none in the future; 152 of 161 open tasks overdue, 9 due today.", "Overdue count (weak, flags 98 accounts)."),
 "completed": ("completed", K, "113 done / 161 open (API maps 1 -> true).", "Open-task filter."),
 "created_at": ("createdAt", D, "2025-02-02..03-09; 32 tasks are due before they were created.", "Task age only."),
}),
("analytics", "customers"): (C, "207 tenants: 199 map to CRM accounts, 8 (cust_200-207) do not. The join bridge; needs normalising.", {
 "id": ("", K, "Primary key; FK of every analytics table.", "Join target (cust_ -> acc_)."),
 "customer_name": ("", C, "Strip env suffixes (-prod, prod, -cloud, -trial, -us, -eu, -sandbox, -holdings, -health-group); 5 names occur twice.", "Join key #3 (name)."),
 "billing_email": ("", C, "100% populated, always @<stem>.example; local part is a role mailbox.", "Join key #2 (billing domain) - used for 24 accounts."),
 "domain": ("", C, "31 null (15%); 170 bare stems without TLD, 6 '<stem>customers.example'.", "Join key #1 (domain) - used for 140 accounts."),
 "external_id": ("", X, "Unique 'synthetic_customer_N', no counterpart in the CRM.", "None."),
 "owner_email": ("", X, "Role mailbox (owner@ on 186/207), not a person; nothing to compare in the CRM.", "None."),
 "region": ("", K, "amer/emea/apac; NULL for cust_001-021. CRM has no region, so it cannot disambiguate.", "Context; regional split for 1:N accounts."),
 "environment_type": ("", X, "206 PRODUCTION / 1 SANDBOX; trial tenants cust_002 and cust_008 are labelled PRODUCTION. Project label + name is better.", "None."),
 "created_at": ("", D, "For all 7 tenants created inside the usage window, first usage = created_at exactly, so it is a reliable tenant start date.", "Signal: tenant started recently (onboarding)."),
 "archived_at": ("", X, "100% NULL.", "None."),
}),
("analytics", "projects"): (C, "415 projects, 1-3 per customer. The name carries the real environment; created_at and last_active_at are unusable.", {
 "id": ("", K, "Primary key.", "Join usage to project class."),
 "customer_id": ("", K, "FK; always equals the customer on the project's usage events.", "Grouping."),
 "name": ("", C, "Suffix gives the environment: staging/qa/internal/sandbox/test/trial/eval (+digits) = non-prod (202 of 415).", "Project classifier -> production-only usage."),
 "environment_type": ("", C, "SANDBOX label is right for the 4 SANDBOX projects, but 198 non-prod-named projects are labelled PRODUCTION (49.8% of PRODUCTION request volume).", "Combine with name class; SANDBOX = pre-customer trial."),
 "created_at": ("", X, "Usage predates created_at on 121/121 projects created inside the window (e.g. ironwoodhealth-new 'created' 2025-02-27, used since 2024-12-15).", "None (use first usage date instead)."),
 "last_active_at": ("", X, "Constant 2025-03-14T08:00Z on all 415 rows.", "None."),
}),
("analytics", "usage_events"): (K, "2,181,098 events, 2024-12-15..2025-03-14, every tenant active through the last day. Use only via pre-aggregates (customer x project x day x event_type x is_nfr).", {
 "id": ("", X, "Row id ue_0000001..ue_2181098.", "None."),
 "customer_id": ("", K, "207 customers.", "Grouping/join."),
 "project_id": ("", K, "415 projects; customer always matches the project's customer.", "Project class (prod vs non-prod)."),
 "event_type": ("", K, "request 1.33M rows, tokens 676k, transcribe 175k.", "Separate metrics."),
 "event_date": ("", K, "90 days; weekday volume about 2.5x weekend, so compare 7-day-aligned windows.", "Trend windows."),
 "quantity": ("", K, "request always 1.0; tokens 156-44,596 (mean 11,384); transcribe 0.41-34.97 (mean 14.0, unit not documented).", "Volume metrics."),
 "environment_type": ("", X, "Always equals the project's environment_type (denormalised copy) - same unreliability.", "None (use project class)."),
 "is_nfr": ("", K, "2.01% of rows (0-3.3% per customer), independent of all other columns.", "Filter: exclude is_nfr=1."),
 "model_name": ("", X, "6 values drawn from a fixed per-event-type mix; every customer uses all 6; no customer/time signal.", "None."),
 "route": ("", X, "7 values, per-event-type mix; every customer uses all 7; no signal.", "None."),
 "agent_used": ("", X, "4 agents + 15% empty, per-event-type mix; every customer uses all; no signal.", "None."),
 "language_used": ("", X, "7 languages + 40% empty (always empty on tokens); every customer uses all; no signal.", "None."),
 "source": ("", X, "4 values, per-event-type mix; every customer uses all 4; no signal.", "None."),
}),
("analytics", "api_keys"): (X, "789 keys. Dates are inconsistent and nothing separates accounts: new keys in the last 30 days on 77/184 accounts and inactive keys on 85, at similar rates for growing, flat and declining accounts.", {
 "id": ("", X, "Row id.", "None."),
 "customer_id": ("", X, "FK (all 207 customers have keys).", "None."),
 "project_id": ("", X, "100% NULL.", "None."),
 "label": ("", X, "Sequence credential-1..14 per customer.", "None."),
 "environment_type": ("", X, "785 PRODUCTION / 4 SANDBOX, mirrors the customer.", "None."),
 "created_at": ("", X, "96 keys (12%) were last used before they were created.", "None."),
 "last_used_at": ("", X, "Customer max(last_used_at) is before 2025-03-14 for 161/207 tenants despite daily usage.", "None."),
 "active": ("", X, "Just a recency flag: all 137 inactive keys were last used before 2025-02-12 and all 652 active keys after it. No deactivation date.", "None."),
}),
("analytics", "contracts"): (K, "129 contracts, one per customer, all active on 2025-03-14. Raw facts are fine; balance does not reconcile with usage.", {
 "id": ("", K, "Primary key.", "Reference."),
 "customer_id": ("", K, "129 distinct customers (incl. all 8 unmatched ones).", "Join to account."),
 "name": ("", X, "Junk: '<random word> <type> product'; the second word always equals type.", "None."),
 "type": ("", K, "credit 50 / prepaid 45 / postpaid 34.", "Which low-balance threshold applies."),
 "amount": ("", K, "9,852-243,830 (total 14.9M).", "Contract size; balance %."),
 "balance": ("", K, "Balance 11%-98% of amount (median 52%). Implied burn does not track usage (r = -0.04) or elapsed term (r = 0.08).", "Signal: balance %, runway (low confidence)."),
 "starting_at": ("", K, "2024-05-22..2025-02-09.", "Elapsed days for burn rate."),
 "ending_before": ("", K, "2025-04-14..2026-01-08 (31-300 days out; 21 of 129 within 90 days, 12 within 60).", "Signal: days to contract end."),
}),
("analytics", "alerts"): (D, "3 alert definitions. Useful only for their thresholds, to recompute alerts ourselves.", {
 "id": ("", D, "alert_low_balance / alert_credit_low / alert_usage_spike.", "Reference."),
 "name": ("", D, "Human label.", "Display when explaining a recomputed alert."),
 "alert_type": ("", D, "low_remaining_commit_balance_reached / low_credit_balance_reached / usage_spike_detected.", "Map to contract type."),
 "threshold": ("", D, "0.20 commit, 0.15 credit, 2.0 spike.", "Recompute low-balance flag: <=0.15 credit/postpaid, <=0.20 prepaid."),
}),
("analytics", "customer_alert_history"): (X, "35 rows, all 'triggered'. Only 1 of 35 fired at or below its threshold; 23 fired with >50% balance left; 9 customers at/below threshold (incl. the 3 lowest) never fired; the spike alert never fired.", {
 "id": ("", X, "Row id.", "None."),
 "customer_id": ("", X, "35 customers.", "None."),
 "alert_id": ("", X, "credit_low 24 (14 credit + 10 postpaid contracts), low_balance 11 (prepaid).", "None."),
 "alert_status": ("", X, "Constant 'triggered'.", "None."),
 "created_at": ("", X, "2025-02-22..2025-03-13.", "None."),
}),
}

def summarize(c):
    if c["distinct"] == 0: return "all NULL"
    if c["distinct"] <= 8:
        return ", ".join(f"{v} ({n})" for v, n in c["top"])
    mn, mx = c["min"], c["max"]
    return f"{str(mn)[:24]} .. {str(mx)[:24]}; {c['distinct']} distinct"

tables = []
def add_from_profile(prof, source):
    for t in prof:
        tv, treason, cols = V[(source, t["table"])]
        out = {"source": source, "table": t["table"], "rows": t["rows"], "verdict": tv, "reason": treason, "columns": []}
        for c in t["columns"]:
            api, cv, cr, use = cols[c["name"]]
            out["columns"].append({"name": c["name"], "api_name": api or None, "type": c["type"], "null_pct": c["null_pct"], "distinct": c["distinct"],
                                   "summary": summarize(c), "samples": c["samples"][:2], "verdict": cv, "reason": cr, "use": use})
        tables.append(out)
add_from_profile(crm, "crm")
add_from_profile(an, "analytics")
# usage_events from the one-pass profile
n = up["rows"]
ue_types = {"id": "TEXT", "customer_id": "TEXT", "project_id": "TEXT", "event_type": "TEXT", "event_date": "TEXT", "quantity": "REAL", "environment_type": "TEXT",
            "is_nfr": "INTEGER", "model_name": "TEXT", "route": "TEXT", "agent_used": "TEXT", "language_used": "TEXT", "source": "TEXT"}
ue_sum = {"id": "ue_0000001 .. ue_2181098 (unique)", "customer_id": "cust_001 .. cust_207", "project_id": "proj_001 .. proj_415",
          "event_type": "request (1,329,689), tokens (676,174), transcribe (175,235)", "event_date": "2024-12-15 .. 2025-03-14 (90 days)",
          "quantity": "request = 1.0 (1 distinct); tokens 155.54..44,595.72 (>200k distinct); transcribe 0.41..34.97 (3,435 distinct)", "environment_type": "PRODUCTION (2,162,847), SANDBOX (18,251)",
          "is_nfr": "0 (2,137,323), 1 (43,775)", "model_name": "corti-s1 30.7%, corti-s1-beta 30.6%, corti-transcribe-v2 23.0%, corti-s1-large 10.3%, corti-clinical-note-v3 2.7%, corti-whisper-large 2.7%",
          "route": "/v1/chat/completions 32.9%, /tools/coding/ 22.5%, /interactions/:id/transcripts/ 14.9%, +4 more", "agent_used": "encounter-copilot 23.0%, admin-assistant 22.9%, coding-agent 19.5%, billing-copilot 19.5%, '' 15.0%",
          "language_used": "'' 40.1%, en 10.1%, es/nl/fr/da/de/sv 8.3% each", "source": "copilot-api-v2 29.7%, web-app 26.4%, sdk 22.0%, api-gateway 21.9%"}
ue_samp = {"id": ["ue_0000001", "ue_0000002"], "customer_id": ["cust_001", "cust_002"], "project_id": ["proj_001", "proj_003"], "event_type": ["request", "tokens"],
           "event_date": ["2025-01-04", "2025-03-14"], "quantity": ["1.0", "7317.66"], "environment_type": ["PRODUCTION", "SANDBOX"], "is_nfr": ["0", "1"],
           "model_name": ["corti-s1", "corti-s1-beta"], "route": ["/v1/chat/completions", "/stream/facts/"], "agent_used": ["encounter-copilot", "coding-agent"],
           "language_used": ["de", "fr"], "source": ["api-gateway", "copilot-api-v2"]}
tv, treason, cols = V[("analytics", "usage_events")]
ue = {"source": "analytics", "table": "usage_events", "rows": n, "verdict": tv, "reason": treason, "columns": []}
for c, typ in ue_types.items():
    api, cv, cr, use = cols[c]
    empt = up["empties"].get(c, 0)
    distinct = n if c == "id" else up["distinct"].get(c)
    ue["columns"].append({"name": c, "api_name": None, "type": typ, "null_pct": round(100 * (up["nulls"].get(c, 0) + empt) / n, 1), "distinct": distinct,
                          "summary": ue_sum[c], "samples": ue_samp[c], "verdict": cv, "reason": cr, "use": use})
# keep source order: crm tables, then analytics in schema order
order = ["accounts", "contacts", "activities", "opportunities", "tasks", "customers", "projects", "usage_events", "api_keys", "contracts", "alerts", "customer_alert_history"]
tables.append(ue)
tables.sort(key=lambda t: order.index(t["table"]))

fc = st["flag_counts"]
SQL_PROJ = ("WITH proj AS (SELECT id, CASE WHEN name LIKE '%-staging%' OR name LIKE '%-qa%' OR name LIKE '%-internal%' OR name LIKE '%-sandbox%' "
            "OR name LIKE '%-test%' OR name LIKE '%-trial%' OR name LIKE '%-eval%' THEN 'nonprod' ELSE 'prod' END cls FROM projects) ")
signals = [
 {"name": "prod_request_trend_28d",
  "definition": "Requests in the last 28 days (2025-02-15..03-14) vs the prior 28 (2025-01-18..02-14) on production-named projects, NFR excluded. growing >= +15%, declining <= -15%, called only if prior-28 >= 100 requests.",
  "logic": SQL_PROJ + "SELECT u.customer_id, SUM(CASE WHEN u.event_date BETWEEN '2025-02-15' AND '2025-03-14' THEN u.quantity ELSE 0 END) l28, "
           "SUM(CASE WHEN u.event_date BETWEEN '2025-01-18' AND '2025-02-14' THEN u.quantity ELSE 0 END) p28 FROM usage_events u JOIN proj p ON p.id=u.project_id "
           "WHERE u.event_type='request' AND u.is_nfr=0 AND p.cls='prod' GROUP BY 1;  -- change = l28/p28-1; sum over the account's matched customers",
  "accounts_flagged": {"growing": fc.get("usage_growing", 0), "declining": fc.get("usage_declining", 0), "flat": st["trend_class"].get("flat"), "low_volume": st["trend_class"].get("low_volume"), "no_prod_named_usage": st["trend_class"].get("no_usage"), "of_resolved": st["resolved_accounts"]},
  "differentiates": "Yes. Customer-level changes are trimodal (about -30%, 0%, +40%) with almost nothing between -20..-10% and +10..+30%, so the 15% cut is robust. Calendar weeks (wk8-11 vs wk4-7) give the same class for 143/146 customers.",
  "notes": "Book-wide baseline is +3.9%. Rolling 7-day windows anchored on the reference date avoid the 6-day partial week and the weekday effect. Trends are assigned per project (within-customer project trends are independent), so 1:N accounts can hide opposite stories."},
 {"name": "name_classifier_impact",
  "definition": "How much excluding non-prod-named projects changes each account's numbers versus trusting environment_type.",
  "logic": "Same query with p.cls='prod' replaced by u.environment_type='PRODUCTION' (trusting the label). No prod-named project is SANDBOX-labelled, so the name filter alone defines production.",
  "accounts_flagged": {"trend_class_changes": st["trend_class_changed_by_classifier"], "become_no_prod_usage": 44, "share_nonprod_0pct": st["nonprod_share_pct"]["zero"], "share_nonprod_100pct": st["nonprod_share_pct"]["hundred"], "share_nonprod_mixed": st["nonprod_share_pct"]["between"], "trend_shift_gt_10pp": st["abs_trend_shift_pp"]["gt10pp"]},
  "differentiates": "Material: class changes for 66 of 184 resolvable accounts (44 lose all production usage); median trend shift 0.3 pp but p90 24 pp.",
  "notes": "Per-project volumes and trend mixes are statistically the same for prod- and non-prod-named projects, so this is a business rule, not something the data proves. Show both numbers when they differ."},
 {"name": "tokens_transcribe_agreement",
  "definition": "Do tokens and transcribe (same windows, same project filter) move in the same class as requests?",
  "logic": "Same query with event_type IN ('tokens','transcribe'); classify with the same +/-15% cut; agreement = same class.",
  "accounts_flagged": {"all_three_agree": st["trend_agreement"].get("all_agree"), "tokens_only_agree": st["trend_agreement"].get("tokens_agree_only"), "transcribe_only_agree": st["trend_agreement"].get("transcribe_agree_only"), "neither_agrees": st["trend_agreement"].get("neither_agrees"), "of_trend_called": 129},
  "differentiates": "As a confidence modifier, not a flag: tokens agree on 117/129 (r = 0.88), transcribe on 100/129 (r = 0.69, lower volume).",
  "notes": "When all three agree, state the trend with high confidence; the 6 'neither agrees' accounts are mostly low-volume or near the 15% cut."},
 {"name": "contract_runway",
  "definition": "balance_pct = balance/amount; linear burn = (amount-balance)/days since starting_at; projected exhaustion = today + balance/burn; compare with ending_before. Low balance = <=15% (credit, postpaid) or <=20% (prepaid), the thresholds from alerts.",
  "logic": "SELECT customer_id, type, balance/amount pct, (amount-balance)/(julianday('2025-03-14')-julianday(substr(starting_at,1,10))) burn, "
           "balance/((amount-balance)/(julianday('2025-03-14')-julianday(substr(starting_at,1,10)))) days_left_at_burn, julianday(substr(ending_before,1,10))-julianday('2025-03-14') days_to_end FROM contracts;",
  "accounts_flagged": {"accounts_with_contract": st["contract"]["accounts_with_contract"], "low_balance": fc.get("low_balance", 0), "balance_runs_out_within_60d": fc.get("balance_runs_out_within_60d", 0), "exhausts_before_end": st["contract"]["exhausts_before_end"]},
  "differentiates": "Low balance yes (10 accounts). 'Exhausts before end' flags 65 of 114 contracts (57%), too broad on its own; the 60-day version (29) is usable.",
  "notes": "Balances do not reconcile with usage: implied burn/day vs requests/day r = -0.04, consumed share vs elapsed term r = 0.08. Present balance % as a stated fact and the runway as an assumption. acc_007 IronwoodHealth: prepaid 12.5% left, runs out about 2025-04-08 vs end 2025-06-12, usage +47%."},
 {"name": "days_to_contract_end_or_renewal",
  "definition": "ending_before - today (analytics) and, for won opps, closeDate - today (CRM renewal date).",
  "logic": "julianday(substr(ending_before,1,10)) - julianday('2025-03-14'); API: opportunities[status='won'].closeDate - 2025-03-14.",
  "accounts_flagged": {"contract_ends_within_60d": fc.get("contract_ends_within_60d", 0), "contract_ends_within_90d": st["contract"]["days_to_end_le_90"], "won_opp_close_within_60d": 11},
  "differentiates": "Yes (5-10%).",
  "notes": "The two dates disagree (median 77 days apart; equal on 1 of 80 pairs). No contract ends within 30 days. Show both and say which source."},
 {"name": "new_projects_30d",
  "definition": "Projects whose created_at (or first usage) is within 30 days of today.",
  "logic": "SELECT customer_id, name FROM projects WHERE created_at >= '2025-02-12'  vs  first usage: SELECT project_id, MIN(event_date) FROM usage_events GROUP BY 1 HAVING MIN(event_date) >= '2025-02-12';",
  "accounts_flagged": {"by_created_at": st["meta_counts"]["new_project_metadata_30d"], "by_first_usage": fc.get("new_project_by_usage_30d", 0)},
  "differentiates": "Doesn't hold up as defined: created_at flags 25 accounts, but usage predates created_at on every project created in the window. By first usage, only acc_005's '-eval' project is new (first used 2025-03-08).",
  "notes": "Named projects like -new, -launch, -api, -coding, -clinical look like intended expansion stories; if used, call them 'project metadata says new' with low confidence."},
 {"name": "tenant_started_recently",
  "definition": "Customer created_at (= first usage) after the window start.",
  "logic": "SELECT id, created_at FROM customers WHERE created_at > '2024-12-15T08:00:00.000Z';  -- plus dormant tenants whose first usage is recent",
  "accounts_flagged": {"usage_started_recently": fc.get("usage_started_recently", 0)},
  "differentiates": "Yes, specific: acc_001, acc_036, acc_109, acc_151, acc_182, acc_188 onboarding, plus acc_005 (dormant closed_lost tenant woke up 2025-03-08). cust_206 has no CRM account.",
  "notes": "The only >=2x jumps over the trailing 4-week mean in the whole dataset are onboarding ramps (cust_001, cust_035, cust_108); the usage_spike alert never fired."},
 {"name": "api_key_changes",
  "definition": "Keys created in the last 30 days; inactive keys.",
  "logic": "SELECT customer_id, SUM(created_at >= '2025-02-12'), SUM(active=0) FROM api_keys GROUP BY 1;",
  "accounts_flagged": {"new_key_30d": st["meta_counts"]["new_key_30d"], "has_inactive_key": st["meta_counts"]["has_inactive_key"], "of_resolved": st["resolved_accounts"]},
  "differentiates": "No. Same rate on growing (52%), flat (45%) and declining (60%) accounts. Dropped.",
  "notes": "12% of keys were last used before they were created; 'active' only encodes last use within 30 days; no deactivation date."},
 {"name": "pre_customer_sandbox",
  "definition": "Accounts in prospect/evaluation/mvp whose tenant has SANDBOX-labelled usage (or only non-prod-named usage).",
  "logic": "SELECT customer_id, SUM(quantity) FROM usage_events WHERE environment_type='SANDBOX' AND event_type='request' AND is_nfr=0 GROUP BY 1;  + CRM stage IN (prospect, evaluation, mvp)",
  "accounts_flagged": {"sandbox_label": fc.get("pre_customer_sandbox_env", 0), "nonprod_named_only": fc.get("pre_customer_nonprod_only", 0)},
  "differentiates": "SANDBOX version is very specific: acc_002 ($742k eval, ~6 req/week trial), acc_006 ($87k eval, sandbox+test growing +38-46%), acc_008 ($1.02M mvp closing 2025-04-13, 2-5 req/week). The name-only version (27) is broad.",
  "notes": "cust_006 and cust_008 also hold credit contracts with fired credit_low alerts, which contradicts 'pre-customer'."},
 {"name": "noncustomer_usage",
  "definition": "Prospect/closed_lost accounts with production-named usage, and the subset with growing usage.",
  "logic": "stage IN ('prospect','closed_lost') AND prod l28 > 0 (any) / AND trend class = growing.",
  "accounts_flagged": {"prospect_with_prod_usage": fc.get("prospect_with_prod_usage", 0), "closed_lost_with_prod_usage": fc.get("closed_lost_with_prod_usage", 0), "noncustomer_growing_usage": fc.get("noncustomer_growing_usage", 0), "closed_lost_reactivated": fc.get("closed_lost_reactivated", 0)},
  "differentiates": "'Any usage' does not: every matched prospect and closed_lost tenant uses the product daily. 'Growing' does (12: acc_003, 017, 037, 057, 085, 099, 118, 126 prospects; acc_033, 046, 106, 124 closed_lost).",
  "notes": "Treat as 'CRM stage is probably stale', i.e. a hygiene or upsell conversation, not proof of a deal."},
 {"name": "days_since_contact",
  "definition": "today - account.lastContactAt.",
  "logic": "API: 2025-03-14 - accounts[].lastContactAt (do not use contacts.lastContactedAt, a copy).",
  "accounts_flagged": {"no_contact_14d_active_stages": fc.get("no_contact_14d", 0), "of_active_stage": 138},
  "differentiates": "Moderately: customers 0-20 days, evaluation/mvp 0-30, prospects 0-69, closed_lost 45-298. >14 days flags 39% of active-stage accounts; use as a tiebreaker.",
  "notes": "Only 1-3 activities per account, so recency is coarse."},
 {"name": "meeting_outcome_and_notes",
  "definition": "Latest meeting outcome and note text from activities.",
  "logic": "API: GET /accounts/:id/activities -> type='meeting' (outcome), type='note' (text).",
  "accounts_flagged": {"positive_meeting": fc.get("positive_meeting", 0), "negative_meeting": fc.get("negative_meeting", 0), "accounts_with_note": 5},
  "differentiates": "Yes but tiny coverage: 8 accounts in total. Highest-precision qualitative evidence (acc_022 negative meeting + dissatisfaction note on -28% usage).",
  "notes": "Meetings carry no attendee (contactIds always []). Notes older than the usage window (acc_003, acc_005) still explain context."},
 {"name": "open_opportunity_value_and_close",
  "definition": "Open opp value and days to its closeDate.",
  "logic": "API: GET /accounts/:id/opportunities -> status='open' -> value, closeDate - 2025-03-14.",
  "accounts_flagged": {"open_opps": 68, "closes_within_45d": fc.get("open_opp_closes_within_45d", 0), "value_within_45d": 5188642, "big_open_deal_low_engagement": fc.get("big_open_deal_low_engagement", 0)},
  "differentiates": "Yes. 18 deals ($5.19M) close within 45 days; combined with engagement it isolates acc_002 and acc_008 (big deals, near-zero product use).",
  "notes": "Don't use account.opportunityAmount for this (it also carries won renewals)."},
 {"name": "stage_vs_reality",
  "definition": "CRM stage contradicted by analytics: prospect/closed_lost with a contract, customer without contract or without production usage.",
  "logic": "stage vs (contract exists) vs (prod-named l28 > 0).",
  "accounts_flagged": {"prospect_with_contract": fc.get("prospect_with_contract", 0), "closed_lost_with_contract": fc.get("closed_lost_with_contract", 0), "customer_without_contract": fc.get("customer_without_contract", 0), "customer_without_prod_usage": fc.get("customer_without_prod_usage", 0)},
  "differentiates": "Weak on its own: contract presence is independent of stage (62% of prospects, 46% of closed_lost, 59% of customers have one), so these are mostly generator noise. Useful as hygiene notes or when combined with a usage trend.",
  "notes": "Strongest specific cases: acc_003 and acc_017 (prospects with contracts, growing usage, notes saying 'no deal'/'low priority'), acc_005 (closed_lost with contract and reactivated usage)."},
 {"name": "declining_near_renewal",
  "definition": "Customer with declining production usage and a renewal (won-opp closeDate) or contract end within 75 days.",
  "logic": "trend class = declining AND stage='customer' AND min(days_to_won_close, days_to_contract_end) <= 75.",
  "accounts_flagged": {"accounts": fc.get("declining_near_renewal", 0)},
  "differentiates": "Yes: acc_009, acc_022, acc_023, acc_127, acc_187.",
  "notes": "Highest-urgency retention list; acc_022 also has the only negative meeting."},
 {"name": "regional_divergence",
  "definition": "1:N accounts whose regional tenants trend in different directions.",
  "logic": "For accounts with >1 matched customer, compare per-customer trend classes.",
  "accounts_flagged": {"accounts": fc.get("regional_trends_diverge", 0)},
  "differentiates": "Only acc_011 CrestlineChild (US +53%, EU -23%; the sum, +13%, looks flat).",
  "notes": "Report per region, never just the sum."},
 {"name": "overdue_tasks",
  "definition": "Open tasks with dueDate < today.",
  "logic": "API: tasks[completed=false && dueDate < '2025-03-14'].",
  "accounts_flagged": {"accounts": fc.get("overdue_tasks", 0)},
  "differentiates": "Weak: 49% of accounts; 152 of 161 open tasks are overdue and no task is due in the future.",
  "notes": "Use for 'what's open' context, not ranking."},
 {"name": "unmatched_tenants",
  "definition": "Analytics customers with no CRM candidate.",
  "logic": "Join output: customers with no account.",
  "accounts_flagged": {"customers": 8, "contract_value": 964424},
  "differentiates": "n/a (outside the 200-account book).",
  "notes": "cust_200-207 all have contracts ($964k) and daily usage, e.g. cust_203 graniteintegrated +27%. Worth one 'not in CRM' line."},
 {"name": "last_week_vs_prior_3",
  "definition": "Last 7 days vs mean of the 3 prior rolling weeks (sudden-change detector).",
  "logic": "prod-named requests r0 vs mean(r1..r3).",
  "accounts_flagged": {"flat_accounts_with_abs_change_ge_20pct": 0},
  "differentiates": "No. It just restates the 28-day trend; no flat account moved >=20% last week. Dropped.",
  "notes": ""},
 {"name": "usage_dimension_mix",
  "definition": "model_name / route / agent_used / language_used / source mix per customer, shift between first and last 4 full weeks, breadth.",
  "logic": "Per customer chi-square vs the global mix within event_type; 2xK test wk0-3 vs wk8-11; distinct values per customer.",
  "accounts_flagged": {"p_lt_0_001_vs_global": "0-1 per dimension (chance)", "shift_p_lt_0_05": "7-12 of 202 per dimension (null rate ~10)", "breadth": "every customer uses every value"},
  "differentiates": "No. Dropped.",
  "notes": "Mixes are fixed per event_type (e.g. language always empty on tokens) but independent of customer and time."},
]

join = {
 "method": "No shared key. Normalise CRM name (drop Group/LLC/Ltd/Inc/Healthcare and ' - North/West', keep [a-z0-9]) and domain (drop .example, keep [a-z0-9]); normalise analytics customer_name (drop -prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group), domain (drop .example and trailing 'customers') and billing-email domain. Candidate = any equal key. Confidence: domain (CRM domain = customer domain) > billing_domain (CRM domain = billing-email domain) > name_only > ambiguous (candidate graph has >1 account or >1 customer per component, except a 1-account -> N-regional-tenants star).",
 "matched": {"accounts_with_candidates": 200, "resolved": st["resolved_accounts"], "by_confidence": st["match_confidence"],
             "domain_links_literal": 71, "domain_links_needing_hyphen_removal": 64, "domain_links_needing_customers_suffix_strip": 6,
             "billing_links_literal": 11, "billing_links_normalised": 13, "one_to_many": {"acc_011": ["cust_011 (us)", "cust_012 (eu)"]}},
 "ambiguous_clusters": [
  {"cluster": "LakeviewMen", "accounts": ["acc_010", "acc_047"], "customers": ["cust_010", "cust_046"], "legit_evidence": "none (same domain, same billing email)", "id_order_hint": {"acc_010": "cust_010", "acc_047": "cust_046"}},
  {"cluster": "SageMedGroup", "accounts": ["acc_013", "acc_014", "acc_015", "acc_062"], "customers": ["cust_014", "cust_061"], "legit_evidence": "semantic only: cust_014 'sagemedgroup-holdings' (finance@, entity-a/entity-b projects) fits the parent acc_013 'Master agreement' plus branches acc_014/015 ('Synced with parent account' / 'Part of master agreement')", "id_order_hint": {"acc_013": "cust_014", "acc_014": "cust_014 (branch)", "acc_015": "cust_014 (branch)", "acc_062": "cust_061"}},
  {"cluster": "PrairieAmbulatory", "accounts": ["acc_020", "acc_146"], "customers": ["cust_019", "cust_145"], "legit_evidence": "none (acc_146 has no domain; both customers share domain and billing)", "id_order_hint": {"acc_020": "cust_019", "acc_146": "cust_145"}},
  {"cluster": "TrinityRehabilitation", "accounts": ["acc_028", "acc_125"], "customers": ["cust_027", "cust_124"], "legit_evidence": "none (accounts share a domain)", "id_order_hint": {"acc_028": "cust_027", "acc_125": "cust_124"}},
  {"cluster": "VeridianSleep", "accounts": ["acc_064", "acc_137"], "customers": ["cust_063", "cust_136"], "legit_evidence": "none (no CRM domains; identical customer name/billing/owner/region)", "id_order_hint": {"acc_064": "cust_063", "acc_137": "cust_136"}},
  {"cluster": "CrestlineSenior", "accounts": ["acc_069", "acc_152"], "customers": ["cust_068", "cust_151"], "legit_evidence": "none (acc_152 has no domain)", "id_order_hint": {"acc_069": "cust_068", "acc_152": "cust_151"}},
  {"cluster": "WindsorFamily", "accounts": ["acc_161", "acc_185"], "customers": ["cust_160", "cust_184"], "legit_evidence": "none (windsorfamily vs windsor-family differ only by a hyphen, and 85 CRM domains are hyphenated while no analytics domain is)", "id_order_hint": {"acc_161": "cust_160", "acc_185": "cust_184"}}],
 "unmatched_customers": ["cust_200", "cust_201", "cust_202", "cust_203", "cust_204", "cust_205", "cust_206", "cust_207"],
 "notes": [
  "Disambiguators tested and rejected: created_at gap (random, -638..+769 days, 58% positive), region (no CRM counterpart), owner_email (role mailboxes), stage vs contract presence (independent), contract ending_before vs opp closeDate (median 77 days apart), opp value vs contract amount (r = 0.12).",
  "Generator artefact (not a key): ids are ordinally aligned. acc_N = cust_N for N<=10, acc_011 = cust_011+012, acc_012/013 = cust_013/014, acc_014/015 have no tenant, acc_N = cust_(N-1) for N>=16. All 183 unambiguous matches agree with it (100% precision check). It also implies the pairing in id_order_hint. Use it only to validate, never as a production join rule.",
  "Within clusters the candidates differ materially (e.g. VeridianSleep: one tenant flat with no contract, the other +34% with a prepaid contract), so a wrong guess would mislead. The preview leaves usage fields empty for the 16 ambiguous accounts and lists each candidate in candidates_summary."]}

corrections = [
 "CrestlineChild (acc_011 -> cust_011 us + cust_012 eu) is not ambiguous: both tenants point only to acc_011, so it is a clean 1:2 map. But the regions diverge (US +53%, EU -23%) and the sum (+13%) looks flat, so report per region.",
 "The 7 duplicate clusters cannot be separated with legitimate fields (created_at, region, owner_email, contracts, opp dates/amounts all tested). Only the generator's ordinal id pattern separates them, which is an artefact.",
 "environment_type: 49.8% of PRODUCTION-labelled request volume (50.6% tokens, 49.8% transcribe) comes from non-prod-named projects - but the names are staging/qa/internal/sandbox(+2/3). The single '-test' project is SANDBOX-labelled, and 18 of 19 '-sandbox' projects are labelled PRODUCTION. Prod- and non-prod-named projects have the same volume and trend distributions, so the name rule is a business assumption the data cannot confirm.",
 "Sandbox-only tenants cust_002/006/008 -> acc_002/006/008 holds. Nuance: only their projects (and cust_006's customer row) say SANDBOX; cust_006 and cust_008 also have credit contracts ($117.9k, $232.5k) and fired credit_low alerts.",
 "Alert history: '~23 fired with >50% balance' is exactly 23/35. Stronger: only 1 of 35 (cust_040, 16.8% vs 0.20) fired at or below its threshold; 9 customers at/below threshold never fired; credit_low also fires on 10 postpaid contracts; usage_spike never fired.",
 "Persona vs title: technical titles always map to 'technical'. Only the 11 non-technical titles get a random executive/clinical/operations persona.",
 "Activities: 198 accounts have 1-3, but acc_014 and acc_015 have none. The 2 email subjects are fully determined by direction.",
 "Tasks: 152/161 open tasks overdue holds; the other 9 are due today, and no task in the CRM is due after 2025-03-14.",
 "Account opportunityAmount/closeDate mirror the opp (135/135, plus nextStep 135/135). They mirror won renewals too, so opportunityAmount is not 'open value' as the docs say.",
 "Usage dimensions are not uniform: each follows a fixed per-event-type mix (e.g. language always empty on tokens; transcribe models only on transcribe). Within event type they are independent of customer and time, so DROP stands.",
 "Constant/empty columns all confirmed. Additions: tasks.description 100% NULL, alert_status constant, and projects.created_at is contradicted by usage on every in-window project.",
 "'Usage on closed_lost/prospect accounts' is universal (every matched tenant has daily usage), so on its own it is not a signal. Only the growing subset (12 accounts) or reactivation (acc_005) is.",
]
caveats = [
 "Reference date 2025-03-14 ('today'). Windows are rolling 7-day weeks anchored on it (L28 = 02-15..03-14, P28 = 01-18..02-14), which avoids the 6-day partial week and the 2.5x weekday/weekend effect.",
 "NFR events (2%) excluded from all usage metrics.",
 "Project environment = name-based rule (staging|qa|internal|sandbox|test|trial|eval + optional digits = non-prod). Shown alongside the label-based number where they differ.",
 "Contract balance does not reconcile with usage; runway/exhaustion uses linear burn since starting_at and is an assumption.",
 "Low-balance thresholds: 0.15 for credit and postpaid, 0.20 for prepaid, inferred from which alert the history attaches to each contract type.",
 "CRM was profiled from SQLite directly. The tool must use the HTTP API: missing values come back as null (not absent); meeting contactIds is always []; type-specific fields only appear on their activity type; opportunities need one call per account.",
 "All timestamps in both sources are 08:00:00.000Z, so day granularity only.",
 "The 16 ambiguous accounts have no usage fields in the preview, by design. The 8 unmatched tenants are outside the preview.",
 "Flags are independent booleans, not a score; counts are of the 200 accounts (184 resolvable).",
 "Synthetic data: tenants cust_001-021 (region NULL) carry the hand-made stories (special project names, notes, meetings). The rest look randomly generated, so don't overfit thresholds to them.",
]

out = {"generated_from": {"crm": "data/crm/crm.sqlite (read-only, direct)", "analytics": "data/analytics/analytics.sqlite (read-only)",
                          "aggregate": "scratchpad/work/agg.sqlite (one pass over usage_events: customer x project x day x event_type x env x is_nfr, plus dimension tables)",
                          "scripts": "scratchpad/scripts/*.py"},
       "reference_date": "2025-03-14", "tables": tables, "signals": signals, "join": join, "corrections": corrections, "caveats": caveats}
vc = collections.Counter(c["verdict"] for t in tables for c in t["columns"])
tc = collections.Counter(t["verdict"] for t in tables)
out["verdict_counts"] = {"columns": dict(vc), "tables": dict(tc), "total_columns": sum(vc.values())}
json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, default=str)
print(json.dumps(out["verdict_counts"], indent=1))
for t in tables: print(t["source"], t["table"], t["rows"], t["verdict"], collections.Counter(c["verdict"] for c in t["columns"]))
