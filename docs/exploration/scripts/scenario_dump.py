import sqlite3, sys, collections
import numpy as np
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(sys.argv[2])
ids = sys.argv[3].split(",")
P = {pid: (cid, name, env, ca) for pid, cid, name, env, ca in an.execute("SELECT id, customer_id, name, environment_type, created_at FROM projects")}
S = collections.defaultdict(lambda: np.zeros(13))
for pid, et, di, q in ag.execute(f"SELECT project_id, event_type, day_idx, SUM(qty) FROM agg_core WHERE is_nfr=0 AND customer_id IN ({','.join('?'*len(ids))}) GROUP BY 1,2,3", ids):
    S[(pid, et)][(89 - di) // 7] += q
for c in ids:
    cu = an.execute("SELECT customer_name, environment_type, region, created_at FROM customers WHERE id=?", (c,)).fetchone()
    k = an.execute("SELECT type, amount, balance, starting_at, ending_before FROM contracts WHERE customer_id=?", (c,)).fetchone()
    al = an.execute("SELECT alert_id, created_at FROM customer_alert_history WHERE customer_id=?", (c,)).fetchall()
    keys = an.execute("SELECT COUNT(*), SUM(active), SUM(created_at >= '2025-02-12'), SUM(active=0), MAX(last_used_at) FROM api_keys WHERE customer_id=?", (c,)).fetchone()
    print(f"== {c} {cu} contract={k} alerts={al} keys(n,active,new30d,inactive,last_used)={keys}")
    for pid in sorted(p for p in P if P[p][0] == c):
        for et in ["request", "tokens", "transcribe"]:
            v = S[(pid, et)]
            if v.sum() == 0: continue
            if et != "request": 
                L, Pv = v[0:4].sum(), v[4:8].sum(); print(f"     {'':38s} {et:10s} L28/P28={L/Pv-1 if Pv else float('nan'):+.0%}"); continue
            L, Pv = v[0:4].sum(), v[4:8].sum()
            print(f"   {pid} {P[pid][1]:30s} {P[pid][2][:4]} created={P[pid][3][:10]} req wk(old->new): {' '.join(str(int(x)) for x in v[11::-1])} | L28/P28={L/Pv-1 if Pv else float('nan'):+.0%}")
