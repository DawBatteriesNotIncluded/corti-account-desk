"""Per-customer usage metrics from agg.sqlite. Writes table cust_usage into agg.sqlite and prints diagnostics.
Usage: python -I usage_metrics.py <analytics.sqlite> <agg.sqlite> <scripts_dir>"""
import sqlite3, sys, collections, json
import numpy as np
sys.path.insert(0, sys.argv[3])
from common import project_class
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(sys.argv[2])
P = {pid: (cid, name, env, project_class(name)) for pid, cid, name, env in an.execute("SELECT id, customer_id, name, environment_type FROM projects")}
ET = ["request", "tokens", "transcribe"]
# rolling weeks ending on the reference date: r=0 -> day_idx 83..89 (2025-03-08..03-14); r=11 -> 6..12; r=12 partial (0..5)
S = collections.defaultdict(lambda: np.zeros(13))
for cid, pid, di, et, env, nfr, n, q in ag.execute("SELECT customer_id, project_id, day_idx, event_type, env, is_nfr, n, qty FROM agg_core"):
    r = (89 - di) // 7
    cls = P[pid][3]
    if nfr == 0:
        S[(cid, "prod_named", et)][r] += q if cls == "prod" and env == "PRODUCTION" else 0
        S[(cid, "labelled_prod", et)][r] += q if env == "PRODUCTION" else 0
        S[(cid, "all", et)][r] += q
        S[(cid, "nonprod_named", et)][r] += q if cls == "nonprod" else 0
    S[(cid, "nfr_rows", et)][r] += n if nfr == 1 else 0
    S[(cid, "rows", et)][r] += n
custs = sorted({k[0] for k in S})
def chg(v):
    L, Pv = v[0:4].sum(), v[4:8].sum()
    return (L / Pv - 1) if Pv > 0 else (None if L == 0 else float("inf")), L, Pv
rows = []
for c in custs:
    d = {"customer_id": c}
    for scope in ["prod_named", "labelled_prod"]:
        for et in ET:
            ch, L, Pv = chg(S[(c, scope, et)])
            d[f"{scope}_{et}_l28"] = L; d[f"{scope}_{et}_p28"] = Pv; d[f"{scope}_{et}_chg"] = ch
    v = S[(c, "prod_named", "request")]
    d["prod_req_l7"] = v[0]; d["prod_req_prev3wk_avg"] = v[1:4].mean()
    d["prod_req_l7_vs_prev3"] = (v[0] / v[1:4].mean() - 1) if v[1:4].mean() > 0 else None
    d["prod_req_weekly"] = " ".join(str(int(x)) for x in v[11::-1])   # oldest -> newest, 12 full rolling weeks
    lab = S[(c, "labelled_prod", "request")].sum(); npn = S[(c, "nonprod_named", "request")].sum(); allr = S[(c, "all", "request")].sum()
    d["nonprod_share_of_labelled_prod_req"] = (lab - S[(c, "prod_named", "request")].sum()) / lab if lab else None
    d["req_total_90d"] = allr
    nf = sum(S[(c, "nfr_rows", et)].sum() for et in ET); tr = sum(S[(c, "rows", et)].sum() for et in ET)
    d["nfr_share"] = nf / tr if tr else None
    rows.append(d)
ag.execute("DROP TABLE IF EXISTS cust_usage")
cols = list(rows[0].keys())
ag.execute(f"CREATE TABLE cust_usage ({', '.join(cols)})")
ag.executemany(f"INSERT INTO cust_usage VALUES ({','.join('?'*len(cols))})", [[r[k] if not (isinstance(r[k], float) and r[k] == float('inf')) else 9.99 for k in cols] for r in rows])
ag.commit()
# diagnostics
def arr(k): return np.array([r[k] for r in rows if r[k] is not None and r[k] != float("inf")], float)
for k in ["prod_named_request_chg", "labelled_prod_request_chg", "prod_named_tokens_chg", "prod_named_transcribe_chg", "prod_req_l7_vs_prev3"]:
    a = arr(k); print(f"{k}: n={len(a)} p5={np.percentile(a,5):+.1%} p25={np.percentile(a,25):+.1%} median={np.median(a):+.1%} p75={np.percentile(a,75):+.1%} p95={np.percentile(a,95):+.1%} min={a.min():+.1%} max={a.max():+.1%}")
print("customers with no prod-named request volume in P28:", [r["customer_id"] for r in rows if r["prod_named_request_p28"] == 0])
ns = arr("nonprod_share_of_labelled_prod_req"); print(f"nonprod share of PRODUCTION-labelled requests per customer: median={np.median(ns):.1%} share of customers with 0%={np.mean(ns==0):.1%} 100%={np.mean(ns>=0.999):.1%} between={np.mean((ns>0)&(ns<0.999)):.1%}")
nf = arr("nfr_share"); print(f"nfr share per customer: min={nf.min():.2%} median={np.median(nf):.2%} max={nf.max():.2%}")
