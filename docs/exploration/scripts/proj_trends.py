import sqlite3, sys, collections
import numpy as np
sys.path.insert(0, sys.argv[3])
from common import project_class, project_suffix
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(sys.argv[2])
P = {pid: (cid, name, env, project_class(name), ca) for pid, cid, name, env, ca in an.execute("SELECT id, customer_id, name, environment_type, created_at FROM projects")}
S = collections.defaultdict(lambda: np.zeros(13))
for pid, di, q in ag.execute("SELECT project_id, day_idx, SUM(qty) FROM agg_core WHERE event_type='request' AND is_nfr=0 GROUP BY 1,2"):
    S[pid][(89 - di) // 7] += q
res = collections.defaultdict(list)
for pid, v in S.items():
    L, Pv = v[0:4].sum(), v[4:8].sum()
    if Pv > 0: res[P[pid][3]].append((L / Pv - 1, pid))
for cls, lst in res.items():
    a = np.array([x[0] for x in lst]); h, e = np.histogram(a, bins=np.arange(-0.40, 0.60, 0.1))
    print(cls, "projects", len(a), "hist", list(zip([f"{x:+.1f}" for x in e[:-1]], h)))
# within one customer: do prod projects share the same trend? (spread of project trends inside a customer)
byc = collections.defaultdict(list)
for cls in res:
    for ch, pid in res[cls]: byc[(P[pid][0], cls)].append(ch)
spread = [max(v) - min(v) for (c, cls), v in byc.items() if cls == "prod" and len(v) > 1]
print("within-customer spread of prod-project trends (max-min):", np.round(sorted(spread), 2))
spread2 = [max(v) - min(v) for (c, cls), v in byc.items() if cls == "nonprod" and len(v) > 1]
print("within-customer spread of nonprod-project trends:", np.round(sorted(spread2), 2))
# customers with both: correlation between prod and nonprod trend
both = [(np.mean(byc[(c, 'prod')]), np.mean(byc[(c, 'nonprod')])) for (c, cls) in byc if cls == 'prod' and (c, 'nonprod') in byc]
x, y = zip(*both); print("customers with both prod & nonprod projects:", len(both), "corr(prod trend, nonprod trend) =", round(np.corrcoef(x, y)[0, 1], 3))
