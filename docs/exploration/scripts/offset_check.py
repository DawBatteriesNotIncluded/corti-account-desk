import sqlite3, sys, re, collections
crm = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
an = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro&immutable=1", uri=True)
accts = {r[0]: r for r in crm.execute("SELECT id, name, domain, stage, created_at FROM accounts")}
custs = {r[0]: r for r in an.execute("SELECT id, customer_name, domain, billing_email, region, owner_email, created_at FROM customers")}
def nk(s):
    s = s.lower()
    s = re.sub(r"\s*-\s*(north|south|east|west)$", "", s)
    s = re.sub(r"\b(group|llc|ltd|inc|healthcare)\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)
def ck(s):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"(-prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group)$", "", s.lower()))
diff = collections.Counter(); bad = []
for a, r in sorted(accts.items()):
    ai = int(a[4:])
    for off in (0, 1):
        c = f"cust_{ai+off:03d}"
        if c in custs and ck(custs[c][1]) == nk(r[1]):
            diff[off] += 1; break
    else:
        bad.append((a, r[1], [custs.get(f"cust_{ai+o:03d}", (None, None))[1] for o in (0, 1)]))
print("acc_N -> cust_(N+off) name agreement:", dict(diff))
print("no agreement:", bad)
# where does the offset start?
for a in ["acc_010","acc_011","acc_012","acc_013","acc_198","acc_199","acc_200"]:
    ai = int(a[4:]); print(a, accts[a][1], "| cust same:", custs.get(f"cust_{ai:03d}", [None,None])[1], "| cust +1:", custs.get(f"cust_{ai+1:03d}", [None,None])[1])
print("region NULL customers:", [c for c, r in sorted(custs.items()) if r[4] is None])
print("owner_email local parts:", collections.Counter(r[5].split('@')[0] for r in custs.values()).most_common())
print("billing local parts:", collections.Counter(r[3].split('@')[0] for r in custs.values()).most_common())
for c in ["cust_200","cust_201","cust_202","cust_203","cust_204","cust_205","cust_206","cust_207"]:
    print(c, custs[c][1:])
