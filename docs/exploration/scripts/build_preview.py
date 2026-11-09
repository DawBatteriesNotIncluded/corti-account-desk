"""Build the 200-row per-account preview (KEEP + derived fields only) and signal statistics.
Usage: python -I build_preview.py <crm.sqlite> <analytics.sqlite> <agg.sqlite> <scripts_dir> <out_csv> <out_stats_json>
Reference date 2025-03-14. Rolling 7-day weeks anchored on the reference date (r=0 = 2025-03-08..03-14)."""
import sqlite3, sys, collections, datetime, json, csv, re
import numpy as np
crm_p, an_p, ag_p, sdir, out_csv, out_stats = sys.argv[1:7]
sys.path.insert(0, sdir)
from common import project_class
from joinlib import build

REF = datetime.date(2025, 3, 14)
d = lambda s: datetime.date.fromisoformat(s[:10]) if s else None
days_since = lambda s: (REF - d(s)).days if s else None
days_until = lambda s: (d(s) - REF).days if s else None
crm = sqlite3.connect(f"file:{crm_p}?mode=ro&immutable=1", uri=True)
an = sqlite3.connect(f"file:{an_p}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(ag_p)

TREND_T = 0.15        # +/-15% L28 vs P28 = growing / declining
MIN_VOL = 100         # min prod requests in the prior 28 days to call a trend
LOW_BAL = {"credit": 0.15, "postpaid": 0.15, "prepaid": 0.20}   # alert thresholds mapped as alert history maps them

# ---------------- CRM ----------------
A = {r[0]: dict(zip(["id", "name", "domain", "industry", "employee_count", "owner_id", "stage", "created_at", "updated_at", "last_contact_at",
                      "next_step", "opportunity_amount", "close_date", "icp_tier"], r))
     for r in crm.execute("SELECT id,name,domain,industry,employee_count,owner_id,stage,created_at,updated_at,last_contact_at,next_step,opportunity_amount,close_date,icp_tier FROM accounts")}
OPP = collections.defaultdict(list)
for r in crm.execute("SELECT account_id,id,name,stage,value,opened_at,close_date,last_stage_change_at,next_step,owner_id,status FROM opportunities"):
    OPP[r[0]].append(dict(zip(["account_id", "id", "name", "stage", "value", "opened_at", "close_date", "last_stage_change_at", "next_step", "owner_id", "status"], r)))
ACT = collections.defaultdict(list)
for r in crm.execute("SELECT account_id,activity_type,direction,timestamp,outcome,text,to_stage FROM activities ORDER BY timestamp"):
    ACT[r[0]].append(dict(zip(["account_id", "type", "direction", "ts", "outcome", "text", "to_stage"], r)))
TASK = collections.defaultdict(list)
for r in crm.execute("SELECT account_id,title,due_date,completed FROM tasks"):
    TASK[r[0]].append(dict(zip(["account_id", "title", "due", "completed"], r)))

# ---------------- analytics ----------------
CU = {r[0]: dict(zip(["id", "customer_name", "billing_email", "domain", "region", "env", "created_at"], r))
      for r in an.execute("SELECT id,customer_name,billing_email,domain,region,environment_type,created_at FROM customers")}
PROJ = collections.defaultdict(list)
for pid, cid, name, env, ca in an.execute("SELECT id,customer_id,name,environment_type,created_at FROM projects"):
    PROJ[cid].append(dict(id=pid, name=name, env=env, cls=project_class(name), created_at=ca))
K = {r[0]: dict(zip(["cid", "type", "amount", "balance", "start", "end"], r)) for r in an.execute("SELECT customer_id,type,amount,balance,starting_at,ending_before FROM contracts")}
KEYS = collections.defaultdict(list)
for cid, ca, lu, act in an.execute("SELECT customer_id,created_at,last_used_at,active FROM api_keys"):
    KEYS[cid].append(dict(created=ca, last_used=lu, active=act))
FIRST = {pid: f for pid, f in ag.execute("SELECT project_id, MIN(event_date) FROM agg_core GROUP BY 1")}
CFIRST = {cid: f for cid, f in ag.execute("SELECT customer_id, MIN(event_date) FROM agg_core GROUP BY 1")}
# weekly series per customer x scope x event type (nfr excluded), rolling weeks r=0..12
PCLS = {p["id"]: p["cls"] for ps in PROJ.values() for p in ps}
W = collections.defaultdict(lambda: np.zeros(13))
for cid, pid, di, et, env, nfr, n, q in ag.execute("SELECT customer_id, project_id, day_idx, event_type, env, is_nfr, n, qty FROM agg_core"):
    if nfr: continue
    r = (89 - di) // 7
    if env == "PRODUCTION": W[(cid, "labelled", et)][r] += q
    if env == "PRODUCTION" and PCLS[pid] == "prod": W[(cid, "prod", et)][r] += q
    if env == "SANDBOX": W[(cid, "sandbox_env", et)][r] += q
    if PCLS[pid] == "nonprod": W[(cid, "nonprod_named", et)][r] += q
    W[(cid, "all", et)][r] += q

# ---------------- join ----------------
m = build([(a["id"], a["name"], a["domain"]) for a in A.values()],
          [(c["id"], c["customer_name"], c["domain"], c["billing_email"]) for c in CU.values()])
c2a = collections.defaultdict(set)
for a, cs in m.items():
    for c in cs: c2a[c].add(a)
# clusters = connected components of the bipartite candidate graph
parent = {}
def find(x):
    parent.setdefault(x, x)
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
for a, cs in m.items():
    for c in cs: parent[find(a)] = find(c)
comp = collections.defaultdict(set)
for a, cs in m.items():
    comp[find(a)].add(a)
    for c in cs: comp[find(a)].add(c)

def trend(v, min_vol=MIN_VOL):
    L, P = float(v[0:4].sum()), float(v[4:8].sum())
    if P < min_vol: return None, L, P, "low_volume" if (P > 0 or L > 0) else "no_usage"
    ch = L / P - 1
    return ch, L, P, ("growing" if ch >= TREND_T else "declining" if ch <= -TREND_T else "flat")

def usage_block(cids):
    """Aggregate usage/contract/key metrics over the matched customer ids (1:N regional tenants are summed)."""
    out = {}
    sumv = lambda scope, et: sum((W[(c, scope, et)] for c in cids), np.zeros(13))
    ch, L, P, cls = trend(sumv("prod", "request"))
    out.update(prod_req_l28=int(L), prod_req_p28=int(P), prod_req_trend_pct=None if ch is None else round(100 * ch, 1), prod_req_trend_class=cls)
    for et in ["tokens", "transcribe"]:
        v = sumv("prod", et)
        # tokens/transcribe use the request volume gate (their own units differ)
        Lq, Pq = float(v[0:4].sum()), float(v[4:8].sum())
        chq = (Lq / Pq - 1) if (Pq > 0 and P >= MIN_VOL) else None
        out[f"prod_{et}_trend_pct"] = None if chq is None else round(100 * chq, 1)
        out[f"_{et}_cls"] = None if chq is None else ("growing" if chq >= TREND_T else "declining" if chq <= -TREND_T else "flat")
    agree = [out["_tokens_cls"], out["_transcribe_cls"]]
    out["trend_agreement"] = (None if cls not in ("growing", "declining", "flat") or None in agree else
                              "all_agree" if all(x == cls for x in agree) else
                              "tokens_agree_only" if agree[0] == cls else "transcribe_agree_only" if agree[1] == cls else "neither_agrees")
    lch, lL, lP, lcls = trend(sumv("labelled", "request"))
    out.update(labelled_req_trend_pct=None if lch is None else round(100 * lch, 1), labelled_req_trend_class=lcls)
    out["trend_class_changed_by_name_classifier"] = (cls != lcls)
    lab = float(sumv("labelled", "request").sum()); prod = float(sumv("prod", "request").sum())
    out["nonprod_share_of_labelled_req_pct"] = round(100 * (lab - prod) / lab, 1) if lab else None
    v = sumv("prod", "request")
    out["prod_req_l7_vs_prev3wk_pct"] = round(100 * (v[0] / v[1:4].mean() - 1), 1) if v[1:4].mean() >= 25 else None
    out["prod_req_weekly_12w"] = " ".join(str(int(x)) for x in v[11::-1])
    sb = float(sumv("sandbox_env", "request").sum()); npn = float(sumv("nonprod_named", "request").sum())
    out["sandbox_env_req_90d"] = int(sb); out["nonprod_named_req_90d"] = int(npn); out["all_req_90d"] = int(float(sumv("all", "request").sum()))
    projs = [p for c in cids for p in PROJ[c]]
    out["projects_prod_named"] = sum(p["cls"] == "prod" for p in projs); out["projects_nonprod_named"] = sum(p["cls"] == "nonprod" for p in projs)
    out["_new_projects_created_at_30d"] = "|".join(p["name"] for p in projs if days_since(p["created_at"]) <= 30)   # DROP column: stats only
    out["new_projects_first_usage_30d"] = "|".join(p["name"] for p in projs if FIRST.get(p["id"]) and days_since(FIRST[p["id"]]) <= 30)
    fs = min(CFIRST[c] for c in cids)
    out["usage_first_seen"] = fs; out["usage_started_in_window"] = fs > "2024-12-15"
    # contract (at most one per customer); 1:N -> list each
    ks = [K[c] for c in cids if c in K]
    if ks:
        out["contract_type"] = "|".join(k["type"] for k in ks)
        amt = sum(k["amount"] for k in ks); bal = sum(k["balance"] for k in ks)
        out["contract_amount"] = amt; out["contract_balance"] = bal; out["balance_pct"] = round(100 * bal / amt, 1)
        end = min(k["end"] for k in ks); out["contract_end"] = end[:10]; out["days_to_contract_end"] = days_until(end)
        el = [(REF - d(k["start"])).days for k in ks]
        burn = sum((k["amount"] - k["balance"]) / max(e, 1) for k, e in zip(ks, el))
        out["burn_per_day_linear"] = round(burn, 1)
        ex = bal / burn if burn > 0 else None
        out["projected_exhaustion"] = (REF + datetime.timedelta(days=int(ex))).isoformat() if ex is not None else None
        out["exhausts_before_end"] = (ex is not None and ex < out["days_to_contract_end"])
        out["low_balance_recomputed"] = any(k["balance"] / k["amount"] <= LOW_BAL[k["type"]] for k in ks)
    else:
        for f in ["contract_type", "contract_amount", "contract_balance", "balance_pct", "contract_end", "days_to_contract_end",
                  "burn_per_day_linear", "projected_exhaustion", "exhausts_before_end", "low_balance_recomputed"]: out[f] = None
    keys = [k for c in cids for k in KEYS[c]]
    # api_keys is a DROP table: computed for the signal evaluation only, not written to the preview
    out["_keys_inactive"] = sum(1 - k["active"] for k in keys)
    out["_keys_created_30d"] = sum(days_since(k["created"]) <= 30 for k in keys)
    out["regions"] = "|".join(sorted({CU[c]["region"] or "?" for c in cids}))
    return out

def short_usage(c):
    u = usage_block([c])
    k = f"{u['contract_type']} {u['balance_pct']}% left" if u["contract_type"] else "no contract"
    t = "n/a" if u["prod_req_trend_pct"] is None else f"{u['prod_req_trend_pct']:+.1f}%"
    return f"{c}({CU[c]['customer_name']}, prod req trend {t} [{u['prod_req_trend_class']}], {k})"

rows = []
for aid in sorted(A):
    a = A[aid]; cs = m[aid]
    row = {"account_id": aid, "account_name": a["name"], "domain": a["domain"], "stage": a["stage"], "owner_id": a["owner_id"],
           "icp_tier": a["icp_tier"], "industry": a["industry"], "employee_count": a["employee_count"]}
    # ---- match
    amb = len(cs) > 1 and not all(len(c2a[c]) == 1 for c in cs) or any(len(c2a[c]) > 1 for c in cs)
    if not cs:
        conf, meth, matched = "none", "no name/domain/billing candidate", []
    elif amb:
        conf = "ambiguous"; matched = []
        cl = comp[find(aid)]
        meth = f"cluster of {len([x for x in cl if x.startswith('acc_')])} accounts x {len([x for x in cl if x.startswith('cust_')])} customers; keys: " + \
               "; ".join(f"{c}:{'+'.join(sorted(ms))}" for c, ms in sorted(cs.items()))
    else:
        ms = set().union(*cs.values())
        conf = "domain" if "domain" in ms else "billing_domain" if "billing" in ms else "name_only"
        matched = sorted(cs)
        meth = "+".join(sorted(ms)) + (f" (1 account -> {len(cs)} regional customers)" if len(cs) > 1 else "")
    row.update(match_confidence=conf, match_method=meth, matched_customer_ids="|".join(matched),
               candidate_customer_ids="|".join(sorted(cs)) if conf == "ambiguous" else "",
               cluster_id=("cl_" + sorted(x for x in comp[find(aid)] if x.startswith("acc_"))[0]) if conf == "ambiguous" else "")
    # ---- usage + contract
    meta = {}
    if matched:
        ub = usage_block(matched)
        row.update({k: v for k, v in ub.items() if not k.startswith("_")})
        meta = {"new_project_metadata_30d": bool(ub["_new_projects_created_at_30d"]), "new_key_30d": ub["_keys_created_30d"] > 0, "has_inactive_key": ub["_keys_inactive"] > 0}
        row["candidates_summary"] = ""
        if len(matched) > 1:
            row["candidates_summary"] = " || ".join(short_usage(c) for c in matched)
    else:
        row["candidates_summary"] = " || ".join(short_usage(c) for c in sorted(cs)) if cs else ""
    # ---- CRM
    row["last_contact_at"] = (a["last_contact_at"] or "")[:10]; row["days_since_contact"] = days_since(a["last_contact_at"])
    row["next_step"] = a["next_step"]
    opps = OPP[aid]
    op = [o for o in opps if o["status"] == "open"]; won = [o for o in opps if o["status"] == "won"]
    row["open_opp_value"] = sum(o["value"] for o in op) if op else None
    row["open_opp_stage"] = "|".join(o["stage"] for o in op) or None
    row["open_opp_close_date"] = min(o["close_date"] for o in op) if op else None
    row["days_to_open_opp_close"] = days_until(row["open_opp_close_date"]) if op else None
    row["open_opp_days_since_stage_change"] = min(days_since(o["last_stage_change_at"]) for o in op) if op else None
    row["won_opp_value"] = sum(o["value"] for o in won) if won else None
    row["won_opp_close_date"] = min(o["close_date"] for o in won) if won else None
    row["days_to_won_opp_close_date"] = days_until(row["won_opp_close_date"]) if won else None
    t = TASK[aid]; ot = [x for x in t if not x["completed"]]
    row["open_tasks"] = len(ot); row["overdue_tasks"] = sum(x["due"] < REF.isoformat() for x in ot)
    row["open_task_titles"] = "|".join(sorted({x["title"] for x in ot}))
    acts = ACT[aid]
    mt = [x for x in acts if x["type"] == "meeting"]; nt = [x for x in acts if x["type"] == "note"]
    em = [x for x in acts if x["type"] == "email"]
    row["n_activities"] = len(acts)
    row["last_meeting"] = f"{mt[-1]['ts'][:10]} {mt[-1]['outcome']}" if mt else None
    row["latest_note"] = f"{nt[-1]['ts'][:10]}: {nt[-1]['text']}" if nt else None
    row["last_email"] = f"{em[-1]['ts'][:10]} {em[-1]['direction']}" if em else None
    # ---- signals / flags
    f = []
    st = a["stage"]
    cls = row.get("prod_req_trend_class")
    if cls == "declining": f.append("usage_declining")
    if cls == "growing": f.append("usage_growing")
    if row.get("trend_agreement") in ("neither_agrees",): f.append("trend_metrics_disagree")
    if row.get("low_balance_recomputed"): f.append("low_balance")
    if row.get("exhausts_before_end") and (row.get("projected_exhaustion") or "9999") <= (REF + datetime.timedelta(days=60)).isoformat(): f.append("balance_runs_out_within_60d")
    if row.get("days_to_contract_end") is not None and row["days_to_contract_end"] <= 60: f.append("contract_ends_within_60d")
    if row.get("new_projects_first_usage_30d"): f.append("new_project_by_usage_30d")
    if row.get("usage_started_in_window"): f.append("usage_started_recently")
    if st in ("prospect", "evaluation", "mvp") and (row.get("sandbox_env_req_90d") or 0) > 0: f.append("pre_customer_sandbox_env")
    if st in ("prospect", "evaluation", "mvp") and matched and row.get("prod_req_p28", 0) + row.get("prod_req_l28", 0) == 0 and (row.get("all_req_90d") or 0) > 0: f.append("pre_customer_nonprod_only")
    if st in ("prospect", "closed_lost") and matched and (row.get("prod_req_l28") or 0) > 0: f.append(f"{st}_with_prod_usage")
    if st in ("prospect", "closed_lost") and row.get("contract_type"): f.append(f"{st}_with_contract")
    if st == "customer" and matched and not row.get("contract_type"): f.append("customer_without_contract")
    if st == "customer" and matched and (row.get("prod_req_l28") or 0) == 0: f.append("customer_without_prod_usage")
    if row["days_to_open_opp_close"] is not None and row["days_to_open_opp_close"] <= 45: f.append("open_opp_closes_within_45d")
    if row["overdue_tasks"]: f.append("overdue_tasks")
    if mt and mt[-1]["outcome"] == "negative": f.append("negative_meeting")
    if mt and mt[-1]["outcome"] == "positive": f.append("positive_meeting")
    if nt and days_since(nt[-1]["ts"]) <= 30: f.append("note_last_30d")
    if st in ("customer", "evaluation", "mvp") and (row["days_since_contact"] or 0) > 14: f.append("no_contact_14d")
    if row.get("regions") and "|" in (row.get("regions") or "") or (len(matched) > 1):
        tr = [usage_block([c])["prod_req_trend_class"] for c in matched]
        if len(set(tr)) > 1: f.append("regional_trends_diverge")
    if op and matched and row["open_opp_value"] >= 500000 and (row.get("all_req_90d") or 0) < 500:
        f.append("big_open_deal_low_engagement")
    # combined signals
    near = [x for x in (row.get("days_to_won_opp_close_date"), row.get("days_to_contract_end")) if x is not None]
    if cls == "declining" and st == "customer" and near and min(near) <= 75: f.append("declining_near_renewal")
    if cls == "growing" and st in ("prospect", "closed_lost"): f.append("noncustomer_growing_usage")
    if st == "closed_lost" and (row.get("new_projects_first_usage_30d") or (row.get("usage_first_seen") or "0") >= "2025-02-12"): f.append("closed_lost_reactivated")
    row["flags"] = "|".join(f)
    row["_meta"] = meta
    rows.append(row)

cols = [k for k in dict.fromkeys(k for r in rows for k in r) if not k.startswith("_")]
with open(out_csv, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
    for r in rows: w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})

# ---------------- stats ----------------
stats = {"accounts": len(rows), "match_confidence": collections.Counter(r["match_confidence"] for r in rows),
         "meta_counts": {k: sum(1 for r in rows if r["_meta"].get(k)) for k in ["new_project_metadata_30d", "new_key_30d", "has_inactive_key"]}}
fl = collections.Counter(x for r in rows for x in r["flags"].split("|") if x)
stats["flag_counts"] = dict(fl.most_common())
stats["flag_counts_by_stage"] = {k: dict(collections.Counter(r["stage"] for r in rows if k in r["flags"].split("|"))) for k in fl}
stats["stage_counts"] = dict(collections.Counter(r["stage"] for r in rows))
res = [r for r in rows if r["matched_customer_ids"]]
stats["resolved_accounts"] = len(res)
stats["trend_class"] = dict(collections.Counter(r.get("prod_req_trend_class") for r in res))
stats["labelled_trend_class"] = dict(collections.Counter(r.get("labelled_req_trend_class") for r in res))
stats["trend_class_changed_by_classifier"] = sum(bool(r.get("trend_class_changed_by_name_classifier")) for r in res)
stats["trend_agreement"] = dict(collections.Counter(r.get("trend_agreement") for r in res))
ns = [r["nonprod_share_of_labelled_req_pct"] for r in res if r.get("nonprod_share_of_labelled_req_pct") is not None]
stats["nonprod_share_pct"] = {"zero": sum(x == 0 for x in ns), "hundred": sum(x >= 99.9 for x in ns), "between": sum(0 < x < 99.9 for x in ns), "median": float(np.median(ns))}
diffs = [abs(r["prod_req_trend_pct"] - r["labelled_req_trend_pct"]) for r in res if r.get("prod_req_trend_pct") is not None and r.get("labelled_req_trend_pct") is not None]
stats["abs_trend_shift_pp"] = {"n": len(diffs), "median": float(np.median(diffs)), "p90": float(np.percentile(diffs, 90)), "max": float(max(diffs)), "gt10pp": sum(x > 10 for x in diffs)}
stats["contract"] = {"accounts_with_contract": sum(1 for r in res if r.get("contract_type")),
                     "balance_pct_le_30": sum(1 for r in res if r.get("balance_pct") is not None and r["balance_pct"] <= 30),
                     "exhausts_before_end": sum(1 for r in res if r.get("exhausts_before_end")),
                     "days_to_end_le_90": sum(1 for r in res if r.get("days_to_contract_end") is not None and r["days_to_contract_end"] <= 90)}
json.dump(stats, open(out_stats, "w"), indent=1, default=str)
print(json.dumps(stats, indent=1, default=str))
