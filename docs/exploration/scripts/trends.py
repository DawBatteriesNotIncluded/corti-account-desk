import sqlite3, sys, collections
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
rows = an.execute("""
SELECT customer_id, CAST((julianday(event_date) - julianday('2024-12-15')) / 7 AS INT) wk,
       event_type, SUM(quantity), COUNT(*)
FROM usage_events WHERE environment_type='PRODUCTION' AND is_nfr=0
GROUP BY 1,2,3""").fetchall()
names = dict(an.execute("SELECT id, customer_name FROM customers"))
d = collections.defaultdict(lambda: collections.defaultdict(lambda: [0]*13))
for c, wk, et, q, n in rows:
    d[c][et][wk] += q
out = []
for c in sorted(d):
    r = d[c]["request"]
    # weeks 0..11 full; wk 12 is 6 days (Mar 9 - Mar 14)
    last4 = sum(r[8:12]); prev4 = sum(r[4:8])
    ch = (last4 - prev4) / prev4 if prev4 else float("inf")
    out.append((c, names[c], ch, r))
print("customer | name | 4w/4w change | weekly requests (wk0..wk12; wk12 partial)")
for c, n, ch, r in out:
    if c <= "cust_024" or abs(ch) > 0.3:
        print(f"{c} | {n:34s} | {ch:+.0%} | {' '.join(str(int(x)) for x in r)}")
import statistics
chs = [o[2] for o in out if o[2] != float('inf')]
print("\nchange distribution: min %.2f p10 %.2f median %.2f p90 %.2f max %.2f" % (min(chs), sorted(chs)[len(chs)//10], statistics.median(chs), sorted(chs)[len(chs)*9//10], max(chs)))
