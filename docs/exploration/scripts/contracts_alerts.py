import sqlite3, sys, collections, datetime
import numpy as np
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(sys.argv[2])
REF = datetime.date(2025, 3, 14)
d = lambda s: datetime.date.fromisoformat(s[:10])
K = an.execute("SELECT id, customer_id, name, type, amount, balance, starting_at, ending_before FROM contracts").fetchall()
H = an.execute("SELECT customer_id, alert_id, alert_status, created_at FROM customer_alert_history").fetchall()
A = {r[0]: r for r in an.execute("SELECT id, name, alert_type, threshold FROM alerts")}
U = {r[0]: r[1:] for r in ag.execute("SELECT customer_id, labelled_prod_request_l28, labelled_prod_tokens_l28, labelled_prod_transcribe_l28, req_total_90d, prod_named_request_chg, labelled_prod_request_chg FROM cust_usage")}
kc = {}
print("contract name vs type (does name mean anything?):")
nt = collections.Counter((k[2], k[3]) for k in K)
for (n, t), c in sorted(nt.items()): print(f"   {n:28s} type={t:9s} {c}")
rows = []
for kid, cid, name, typ, amt, bal, st, en in K:
    el = (REF - d(st)).days; left = (d(en) - REF).days; term = (d(en) - d(st)).days
    consumed = amt - bal; burn = consumed / el if el > 0 else None
    exh_days = bal / burn if burn else None
    rows.append(dict(cid=cid, typ=typ, amt=amt, bal=bal, pct=bal / amt, el=el, left=left, term=term, consumed=consumed, burn=burn, exh_days=exh_days,
                     exhaust_before_end=(exh_days is not None and exh_days < left), time_pct=el / term, usage=U.get(cid)))
    kc[cid] = rows[-1]
pct = np.array([r["pct"] for r in rows]); print(f"\nbalance % : min={pct.min():.1%} p10={np.percentile(pct,10):.1%} median={np.median(pct):.1%} p90={np.percentile(pct,90):.1%} max={pct.max():.1%}")
print("balance % <=20%:", sum(pct <= 0.2), " <=15%:", sum(pct <= 0.15), " <=30%:", sum(pct <= 0.3))
print("round-number contracts (amount % 1000 == 0):", [(r['cid'], r['amt'], r['bal']) for r in rows if r['amt'] % 1000 == 0])
tp = np.array([r["time_pct"] for r in rows]); cons = 1 - pct
print(f"corr(consumed share, elapsed share of term) = {np.corrcoef(tp, cons)[0,1]:.3f}  (linear burn would give ~1)")
# does consumed amount track usage volume?
xs = [(r["consumed"] / max(r["el"], 1), r["usage"][0] / 28) for r in rows if r["usage"]]
a, b = zip(*xs); print(f"corr(contract burn/day, prod-labelled requests/day L28) = {np.corrcoef(a, b)[0,1]:.3f} n={len(xs)}")
xs = [(r["consumed"] / max(r["el"], 1), r["usage"][1] / 28) for r in rows if r["usage"]]
a, b = zip(*xs); print(f"corr(contract burn/day, tokens/day L28) = {np.corrcoef(a, b)[0,1]:.3f}")
print(f"exhaust before ending_before (linear burn): {sum(r['exhaust_before_end'] for r in rows)} of {len(rows)}")
lft = np.array([r["left"] for r in rows]); print(f"days to ending_before: min={lft.min()} median={np.median(lft):.0f} max={lft.max()}; <=30d: {sum(lft<=30)} <=60d: {sum(lft<=60)} <=90d: {sum(lft<=90)}")
print("\nalert history:")
print("  alert_id x contract type:", collections.Counter((h[1], kc[h[0]]["typ"] if h[0] in kc else "NO CONTRACT") for h in H))
over50 = [(h[0], h[1], round(kc[h[0]]["pct"], 2)) for h in H if h[0] in kc and kc[h[0]]["pct"] > 0.5]
print(f"  fired with >50% balance remaining: {len(over50)} of {len(H)}")
legit = [(h[0], h[1], round(kc[h[0]]["pct"], 3)) for h in H if h[0] in kc and kc[h[0]]["pct"] <= A[h[1]][3]]
print(f"  fired with balance <= its threshold: {len(legit)} {legit}")
print("  balance % of alerted customers:", sorted(round(kc[h[0]]['pct'], 2) for h in H if h[0] in kc))
fired = {h[0] for h in H}
low = sorted((r["pct"], r["cid"], r["typ"]) for r in rows)[:10]
print("  10 lowest balances (pct, cust, type, fired?):", [(round(p, 3), c, t, c in fired) for p, c, t in low])
print("  customers at/below threshold that never fired:", [(r['cid'], r['typ'], round(r['pct'], 3)) for r in rows if r['cid'] not in fired and r['pct'] <= (0.15 if r['typ'] == 'credit' else 0.2)])
print("  alert created_at range:", min(h[3] for h in H), max(h[3] for h in H))
# alerts vs recent usage spike?
# usage spike check: weekly ratio vs trailing mean
S = collections.defaultdict(lambda: np.zeros(13))
for c, di, q in ag.execute("SELECT customer_id, day_idx, SUM(qty) FROM agg_core WHERE event_type='request' AND is_nfr=0 AND env='PRODUCTION' GROUP BY 1,2"): S[c][(89 - di) // 7] += q
sp = []
for c, v in S.items():
    w = v[11::-1]
    for i in range(4, 12):
        base = w[i-4:i].mean()
        if base >= 20 and w[i] / base >= 2.0: sp.append((c, i, w[i], base))
print("\nweekly request spikes >=2x trailing-4-week mean (base>=20):", sp)
dd = collections.defaultdict(dict)
for c, di, q in ag.execute("SELECT customer_id, day_idx, SUM(qty) FROM agg_core WHERE event_type='request' AND is_nfr=0 GROUP BY 1,2"): dd[c][di] = q
dsp = 0; dex = []
for c, m in dd.items():
    for di in range(28, 90):
        base = np.mean([m.get(x, 0) for x in range(di - 28, di) if (x % 7) == (di % 7)])  # same weekday baseline
        if base >= 10 and m.get(di, 0) / base >= 2.0: dsp += 1; dex.append((c, di, m.get(di, 0), round(base, 1)))
print("daily spikes >=2x same-weekday 4wk baseline (base>=10):", dsp, dex[:10])
