"""Do model_name/route/agent_used/language_used/source carry account-level signal?"""
import sqlite3, sys, collections
import numpy as np
from scipy.stats import chi2_contingency, chi2
ag = sqlite3.connect(sys.argv[1])
DIMS = ["model_name", "route", "agent_used", "language_used", "source"]
print("== global mix (is_nfr=0, all event types, row counts)")
for d in DIMS:
    rows = ag.execute("SELECT value, SUM(n) FROM agg_dim WHERE dim=? GROUP BY 1 ORDER BY 2 DESC", (d,)).fetchall()
    tot = sum(r[1] for r in rows)
    print(f"  {d}: " + ", ".join(f"{v or '(empty)'} {c/tot:.1%}" for v, c in rows))
print("\n== dim x event_type (share of event_type rows) -- is the dim semantically tied to event type?")
for d in DIMS:
    rows = ag.execute("SELECT value, event_type, n FROM dim_etype WHERE dim=?", (d,)).fetchall()
    et_tot = collections.Counter(); 
    for v, e, n in rows: et_tot[e] += n
    tab = collections.defaultdict(dict)
    for v, e, n in rows: tab[v][e] = n / et_tot[e]
    print(f"  {d}:")
    for v in sorted(tab): print(f"     {v or '(empty)':32s} " + "  ".join(f"{e}={tab[v].get(e,0):.1%}" for e in ["request", "tokens", "transcribe"]))
print("\n== pairwise independence (Cramer's V on global crosstab)")
for a in range(5):
    for b in range(a + 1, 5):
        rows = ag.execute("SELECT val_a, val_b, n FROM dim_pair WHERE dim_a=? AND dim_b=?", (DIMS[a], DIMS[b])).fetchall()
        va = sorted({r[0] for r in rows}); vb = sorted({r[1] for r in rows})
        M = np.zeros((len(va), len(vb)))
        for x, y, n in rows: M[va.index(x), vb.index(y)] = n
        c2, p, dof, _ = chi2_contingency(M)
        V = (c2 / (M.sum() * (min(M.shape) - 1))) ** 0.5
        print(f"  {DIMS[a]} x {DIMS[b]}: V={V:.4f} p={p:.3g}")
print("\n== dim x is_nfr (Cramer's V)")
for d in DIMS:
    rows = ag.execute("SELECT value, is_nfr, n FROM dim_nfr WHERE dim=?", (d,)).fetchall()
    vs = sorted({r[0] for r in rows}); M = np.zeros((len(vs), 2))
    for v, f, n in rows: M[vs.index(v), f] = n
    c2, p, dof, _ = chi2_contingency(M); print(f"  {d}: V={(c2/M.sum())**0.5:.4f} p={p:.3g}")
print("\n== per-customer mix vs global (chi-square goodness of fit, request+tokens+transcribe rows, nfr=0)")
for d in DIMS:
    rows = ag.execute("SELECT customer_id, value, SUM(n) FROM agg_dim WHERE dim=? GROUP BY 1,2", (d,)).fetchall()
    vals = sorted({r[1] for r in rows}); cust = collections.defaultdict(lambda: np.zeros(len(vals)))
    for c, v, n in rows: cust[c][vals.index(v)] += n
    G = sum(cust.values()); g = G / G.sum()
    pv = []; maxdev = []; breadth = collections.Counter()
    for c, x in cust.items():
        e = g * x.sum(); stat = ((x - e) ** 2 / e).sum(); pv.append(chi2.sf(stat, len(vals) - 1))
        maxdev.append(np.abs(x / x.sum() - g).max()); breadth[int((x > 0).sum())] += 1
    pv = np.array(pv); md = np.array(maxdev)
    print(f"  {d}: customers={len(pv)} p<0.05: {(pv<0.05).sum()} (expect ~{0.05*len(pv):.0f}) p<0.001: {(pv<0.001).sum()} (expect ~{0.001*len(pv):.1f}); max share deviation median={np.median(md):.3f} max={md.max():.3f}; distinct values used per customer: {dict(sorted(breadth.items()))} of {len(vals)}")
    worst = sorted(zip(pv, cust.keys()))[:3]
    print(f"     lowest p: {[(c, f'{p:.2g}', int(cust[c].sum())) for p, c in worst]}")
print("\n== shift first 4 full weeks (wk0-3) vs last 4 full weeks (wk8-11), per customer, chi-square 2xK")
for d in DIMS:
    rows = ag.execute("SELECT customer_id, CASE WHEN week BETWEEN 0 AND 3 THEN 0 WHEN week BETWEEN 8 AND 11 THEN 1 END per, value, SUM(n) FROM agg_dim WHERE dim=? AND (week BETWEEN 0 AND 3 OR week BETWEEN 8 AND 11) GROUP BY 1,2,3", (d,)).fetchall()
    vals = sorted({r[2] for r in rows}); cust = collections.defaultdict(lambda: np.zeros((2, len(vals))))
    for c, per, v, n in rows: cust[c][per, vals.index(v)] += n
    pv = []; tvd = []; newv = 0; lostv = 0; ex = []
    for c, M in cust.items():
        if M[0].sum() < 50 or M[1].sum() < 50: continue
        Mm = M[:, M.sum(0) > 0]
        c2, p, dof, _ = chi2_contingency(Mm); pv.append(p)
        a, b = M[0] / M[0].sum(), M[1] / M[1].sum(); tvd.append(0.5 * np.abs(a - b).sum())
        if ((M[0] == 0) & (M[1] > 5)).any(): newv += 1; ex.append(c)
        if ((M[0] > 5) & (M[1] == 0)).any(): lostv += 1
    pv = np.array(pv); tvd = np.array(tvd)
    print(f"  {d}: tested={len(pv)} p<0.05: {(pv<0.05).sum()} (expect ~{0.05*len(pv):.0f}) p<0.001: {(pv<0.001).sum()}; TVD median={np.median(tvd):.3f} p95={np.percentile(tvd,95):.3f} max={tvd.max():.3f}; customers with a value absent in wk0-3 but >5 rows in wk8-11: {newv} {ex[:5]}; value dropped: {lostv}")
