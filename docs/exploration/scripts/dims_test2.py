"""Event-type-stratified tests: per-customer dim mix vs global mix *within event type*; event-type mix shifts."""
import sqlite3, sys, collections
import numpy as np
from scipy.stats import chi2, chi2_contingency
ag = sqlite3.connect(sys.argv[1])
DIMS = ["model_name", "route", "agent_used", "language_used", "source"]
for d in DIMS:
    rows = ag.execute("SELECT customer_id, event_type, value, SUM(n) FROM agg_dim WHERE dim=? GROUP BY 1,2,3", (d,)).fetchall()
    glob = collections.defaultdict(collections.Counter); cust = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for c, e, v, n in rows: glob[e][v] += n; cust[c][e][v] += n
    pv = []; worst = []
    for c, byE in cust.items():
        stat = 0; dof = 0
        for e, cnt in byE.items():
            vals = [v for v in glob[e] if glob[e][v] > 0]
            g = np.array([glob[e][v] for v in vals], float); g /= g.sum()
            x = np.array([cnt.get(v, 0) for v in vals], float)
            if x.sum() == 0: continue
            ex = g * x.sum(); stat += ((x - ex) ** 2 / ex).sum(); dof += len(vals) - 1
        p = chi2.sf(stat, dof); pv.append(p); worst.append((p, c, sum(sum(v.values()) for v in byE.values())))
    pv = np.array(pv)
    print(f"{d}: stratified by event_type -> p<0.05: {(pv<0.05).sum()}/{len(pv)} (expect ~{0.05*len(pv):.0f}); p<0.001: {(pv<0.001).sum()} (expect ~0.2); lowest: {[(c, f'{p:.2g}', n) for p, c, n in sorted(worst)[:3]]}")
print()
# event-type mix per customer and shifts (nfr=0, all projects)
rows = ag.execute("""SELECT customer_id, CASE WHEN week BETWEEN 0 AND 3 THEN 0 WHEN week BETWEEN 8 AND 11 THEN 1 END per, event_type, SUM(n)
                     FROM agg_core WHERE is_nfr=0 AND (week BETWEEN 0 AND 3 OR week BETWEEN 8 AND 11) GROUP BY 1,2,3""").fetchall()
ET = ["request", "tokens", "transcribe"]
cust = collections.defaultdict(lambda: np.zeros((2, 3)))
for c, per, e, n in rows: cust[c][per, ET.index(e)] += n
mix = np.array([M.sum(0) / M.sum() for M in cust.values()])
print("event-type row share across customers (min/median/max):", [(ET[i], round(mix[:, i].min(), 3), round(float(np.median(mix[:, i])), 3), round(mix[:, i].max(), 3)) for i in range(3)])
pv = []; started = []; stopped = []
for c, M in cust.items():
    if M[0].sum() >= 50 and M[1].sum() >= 50:
        Mm = M[:, M.sum(0) > 0]
        if Mm.shape[1] > 1: pv.append((chi2_contingency(Mm)[1], c))
    for i in range(3):
        if M[0, i] == 0 and M[1, i] > 10: started.append((c, ET[i], int(M[1, i])))
        if M[0, i] > 10 and M[1, i] == 0: stopped.append((c, ET[i], int(M[0, i])))
p = np.array([x[0] for x in pv])
print(f"event-type mix shift wk0-3 vs wk8-11: tested {len(p)}, p<0.05 {(p<0.05).sum()} (expect ~{0.05*len(p):.0f}), p<0.001 {(p<0.001).sum()}; lowest {[(c, f'{q:.2g}') for q, c in sorted(pv)[:6]]}")
print("event type started (0 in wk0-3, >10 in wk8-11):", started)
print("event type stopped:", stopped)
# customers with no transcribe at all / tokens per request ratio spread
tot = collections.defaultdict(lambda: np.zeros(3))
for c, e, n, q in ag.execute("SELECT customer_id, event_type, SUM(n), SUM(qty) FROM agg_core WHERE is_nfr=0 GROUP BY 1,2"):
    tot[c][ET.index(e)] = n
print("customers with zero transcribe rows:", [c for c, v in tot.items() if v[2] == 0])
print("customers with zero tokens rows:", [c for c, v in tot.items() if v[1] == 0])
for c in ["cust_091", "cust_094", "cust_173", "cust_005", "cust_001"]:
    print(c, "rows by type", tot[c].astype(int).tolist(), "| wk0-3 vs wk8-11:", cust[c].astype(int).tolist())
