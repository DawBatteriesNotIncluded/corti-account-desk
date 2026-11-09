import sqlite3, sys, collections, datetime
sys.path.insert(0, sys.argv[3])
from joinlib import build
crm = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
an = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro&immutable=1", uri=True)
accts = crm.execute("SELECT id, name, domain FROM accounts ORDER BY id").fetchall()
custs = an.execute("SELECT id, customer_name, domain, billing_email FROM customers ORDER BY id").fetchall()
m = build(accts, custs)
c2a = collections.defaultdict(set)
for a, cs in m.items():
    for c in cs: c2a[c].add(a)
meth = collections.Counter(); unamb = {}
for a, cs in sorted(m.items()):
    amb = len(cs) > 1 or any(len(c2a[c]) > 1 for c in cs)
    if not cs: meth["none"] += 1; continue
    if amb: meth["ambiguous"] += 1; continue
    (c, ms), = cs.items()
    unamb[a] = c
    key = "domain" if "domain" in ms else ("billing" if "billing" in ms else "name_only")
    meth[key] += 1
    if "name" not in ms: meth["(no name agreement)"] += 1
print("method counts:", dict(meth))
# conflicts: accounts where domain-matched cust differs from name-matched cust
for a, cs in m.items():
    names = {c for c, ms in cs.items() if "name" in ms}; doms = {c for c, ms in cs.items() if ms & {"domain", "billing"}}
    if names and doms and names != doms: print("  name/domain disagree:", a, cs)
    if doms and not names: print("  domain-only (name differs):", a, cs)
# ordinal artefact check
def ordinal(a):
    n = int(a[4:])
    if n <= 10: return {f"cust_{n:03d}"}
    if n == 11: return {"cust_011", "cust_012"}
    if n in (12, 13): return {f"cust_{n+1:03d}"}
    if n in (14, 15): return {"cust_014"}
    return {f"cust_{n-1:03d}"}
agree = sum(1 for a, c in unamb.items() if {c} == ordinal(a))
print(f"unambiguous matches agreeing with ordinal id pattern: {agree}/{len(unamb)}")
print("disagree:", [(a, c, ordinal(a)) for a, c in unamb.items() if {c} != ordinal(a)])
# legit disambiguator candidates on unambiguous pairs
A = {r[0]: r for r in crm.execute("SELECT id, stage, created_at, employee_count, opportunity_amount, close_date FROM accounts")}
O = {r[0]: r for r in crm.execute("SELECT account_id, stage, status, value, close_date FROM opportunities")}
K = {r[0]: r for r in an.execute("SELECT customer_id, type, amount, balance, starting_at, ending_before FROM contracts")}
CU = {r[0]: r for r in an.execute("SELECT id, created_at, region FROM customers")}
d = lambda s: datetime.date.fromisoformat(s[:10])
gaps = []; st = collections.Counter(); cd = []; amt = []
for a, c in unamb.items():
    gaps.append((d(CU[c][1]) - d(A[a][2])).days)
    st[(A[a][1], c in K)] += 1
    if a in O and c in K:
        cd.append((d(K[c][5]) - d(O[a][4])).days)
        amt.append((O[a][3], K[c][2]))
gaps.sort()
print("customer.created_at - account.created_at (days): min", gaps[0], "p10", gaps[len(gaps)//10], "median", gaps[len(gaps)//2], "p90", gaps[len(gaps)*9//10], "max", gaps[-1], "share>0:", sum(g > 0 for g in gaps)/len(gaps))
print("stage x has_contract:", sorted(st.items()))
cd.sort(); print("contract ending_before - opp close_date (days):", cd[:5], "median", cd[len(cd)//2] if cd else None, cd[-5:], "n", len(cd), "exact==0:", sum(x == 0 for x in cd))
import statistics
if amt:
    xs, ys = zip(*amt); print("corr(opp value, contract amount):", round(statistics.correlation(xs, ys), 3), "n", len(amt))
