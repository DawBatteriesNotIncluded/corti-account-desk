"""Column profile of small tables. Usage: python -I profile_tables.py <db> <label> <out.json> [table ...]"""
import sqlite3, sys, json, collections
db, label, outp = sys.argv[1], sys.argv[2], sys.argv[3]
tables = sys.argv[4:]
con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
if not tables:
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
res = []
for t in tables:
    info = con.execute(f'PRAGMA table_info("{t}")').fetchall()
    rows = con.execute(f'SELECT * FROM "{t}"').fetchall()
    n = len(rows)
    cols = []
    for i, (cid, name, ctype, notnull, dflt, pk) in enumerate(info):
        vals = [r[i] for r in rows]
        types = collections.Counter(type(v).__name__ for v in vals)
        nnull = sum(v is None for v in vals)
        nempty = sum(isinstance(v, str) and v.strip() == "" for v in vals)
        good = [v for v in vals if v is not None and not (isinstance(v, str) and v.strip() == "")]
        cnt = collections.Counter(good)
        try:
            mn, mx = (min(good), max(good)) if good else (None, None)
        except TypeError:
            mn, mx = None, None
        cols.append({"name": name, "type": ctype, "storage": dict(types), "rows": n, "null": nnull, "empty": nempty,
                     "null_pct": round(100 * (nnull + nempty) / n, 1) if n else None, "distinct": len(cnt),
                     "min": mn, "max": mx, "top": cnt.most_common(8), "samples": [str(v) for v in list(dict.fromkeys(good))[:3]]})
    res.append({"source": label, "table": t, "rows": n, "columns": cols})
json.dump(res, open(outp, "w"), indent=1, default=str)
for t in res:
    print(f"=== {t['source']}.{t['table']} rows={t['rows']}")
    for c in t["columns"]:
        top = ", ".join(f"{str(v)[:38]}({k})" for v, k in c["top"][:6])
        print(f"  {c['name']:22s} {c['type']:8s} st={c['storage']} null={c['null']} empty={c['empty']} ({c['null_pct']}%) d={c['distinct']} min={str(c['min'])[:26]} max={str(c['max'])[:26]} | {top}")
