import sqlite3, sys, re, collections
crm = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
an = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True)
LEGAL = r"\b(group|llc|ltd|inc|healthcare)\b"
def crm_keys(name, domain):
    keys = {}
    n = name.lower()
    n2 = re.sub(r"\s*-\s*(north|south|east|west)$", "", n)
    n2 = re.sub(LEGAL, "", n2)
    keys["name"] = re.sub(r"[^a-z0-9]", "", n2)
    if domain:
        keys["domain"] = re.sub(r"[^a-z0-9]", "", domain.lower().replace(".example", ""))
    return keys
SUF = r"(-prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group)$"
def cust_keys(cname, domain, bill):
    keys = {}
    keys["name"] = re.sub(r"[^a-z0-9]", "", re.sub(SUF, "", cname.lower()))
    bd = bill.split("@")[1].lower().replace(".example", "")
    keys["billing"] = re.sub(r"[^a-z0-9]", "", bd)
    if domain:
        keys["domain"] = re.sub(r"[^a-z0-9]", "", domain.lower().replace(".example", "").replace("customers", ""))
    return keys
accts = crm.execute("SELECT id, name, domain, stage FROM accounts ORDER BY id").fetchall()
custs = an.execute("SELECT id, customer_name, domain, billing_email FROM customers ORDER BY id").fetchall()
idx = collections.defaultdict(set)
for cid, cn, dom, bill in custs:
    for k in cust_keys(cn, dom, bill).values():
        idx[k].add(cid)
matched = collections.defaultdict(set)
unmatched = []
for aid, name, dom, stage in accts:
    ks = crm_keys(name, dom)
    hits = set()
    for k in ks.values(): hits |= idx.get(k, set())
    if hits: matched[aid] = hits
    else: unmatched.append((aid, name, dom, stage, ks))
print("accounts matched:", len(matched), "unmatched:", len(unmatched))
cust_to_accts = collections.defaultdict(set)
for a, cs in matched.items():
    for c in cs: cust_to_accts[c].add(a)
print("\n-- accounts with >1 customer:")
for a, cs in matched.items():
    if len(cs) > 1: print(a, [n for n in accts if n[0]==a][0][1], sorted(cs))
print("\n-- customers mapped to >1 account:")
names = {a[0]: (a[1], a[2], a[3]) for a in accts}
for c, as_ in sorted(cust_to_accts.items()):
    if len(as_) > 1: print(c, [ (x, names[x]) for x in sorted(as_)])
print("\n-- unmatched accounts:")
for u in unmatched: print(u)
allc = {c[0] for c in custs}
print("\n-- customers with no account:", sorted(allc - set(cust_to_accts)))
for c in custs:
    if c[0] not in cust_to_accts: print("  ", c)
