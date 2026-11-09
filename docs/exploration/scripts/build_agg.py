"""One full pass over usage_events -> compact aggregates in a scratch SQLite + JSON column profile.
Usage: python -I build_agg.py <analytics.sqlite> <out_agg.sqlite> <out_profile.json>"""
import sqlite3, sys, collections, datetime, json, time, os, re
src, out, prof_out = sys.argv[1], sys.argv[2], sys.argv[3]
t0 = time.time()
an = sqlite3.connect(f"file:{src}?mode=ro&immutable=1", uri=True)
projects = {pid: (cid, name, env) for pid, cid, name, env in an.execute("SELECT id, customer_id, name, environment_type FROM projects")}
custs = {cid: env for cid, env in an.execute("SELECT id, environment_type FROM customers")}
base = datetime.date(2024, 12, 15)
dcache = {}
def dinfo(s):
    v = dcache.get(s)
    if v is None:
        try:
            d = datetime.date.fromisoformat(s)
            di = (d - base).days
            v = (di, di // 7, True)
        except Exception:
            v = (None, None, False)
        dcache[s] = v
    return v
DIMS = ["model_name", "route", "agent_used", "language_used", "source"]
core = collections.defaultdict(lambda: [0, 0.0])
dimagg = collections.defaultdict(lambda: [0, 0.0])
C = collections.Counter
dim_nfr = C(); pair = C(); dim_etype = C(); dim_env = C()
nulls = C(); empties = C()
distinct = {c: set() for c in ["customer_id", "project_id", "event_type", "event_date", "environment_type", "is_nfr"] + DIMS}
qstats = {}
qdistinct = collections.defaultdict(set)
env_x = C()
bad = C()
n = 0
cur = an.execute("SELECT customer_id, project_id, event_type, event_date, quantity, environment_type, is_nfr, model_name, route, agent_used, language_used, source FROM usage_events")
cols = ["customer_id", "project_id", "event_type", "event_date", "quantity", "environment_type", "is_nfr"] + DIMS
while True:
    rows = cur.fetchmany(200000)
    if not rows:
        break
    for r in rows:
        n += 1
        cid, pid, et, ed, q, env, nfr = r[0], r[1], r[2], r[3], r[4], r[5], r[6]
        dv = r[7:]
        for i, v in enumerate(r):
            if v is None:
                nulls[cols[i]] += 1
            elif v == "":
                empties[cols[i]] += 1
        for c, v in ((cols[0], cid), (cols[1], pid), (cols[2], et), (cols[3], ed), (cols[5], env), (cols[6], nfr)):
            distinct[c].add(v)
        di, wk, ok = dinfo(ed)
        if not ok:
            bad["bad_date"] += 1
        k = (cid, pid, ed, et, env, nfr)
        a = core[k]; a[0] += 1; a[1] += q
        s = qstats.get(et)
        if s is None:
            qstats[et] = [q, q, 0.0, 0]; s = qstats[et]
        if q < s[0]: s[0] = q
        if q > s[1]: s[1] = q
        s[2] += q; s[3] += 1
        if len(qdistinct[et]) < 200000: qdistinct[et].add(q)
        p = projects.get(pid)
        if p is None:
            bad["unknown_project"] += 1; penv = None
        else:
            penv = p[2]
            if p[0] != cid: bad["project_customer_mismatch"] += 1
        env_x[(env, penv, custs.get(cid))] += 1
        for j, dname in enumerate(DIMS):
            v = dv[j]
            distinct[dname].add(v)
            dim_nfr[(dname, v, nfr)] += 1
            dim_etype[(dname, v, et)] += 1
            dim_env[(dname, v, env)] += 1
            if nfr == 0:
                a2 = dimagg[(dname, cid, pid, wk, et, v)]; a2[0] += 1; a2[1] += q
        for i in range(5):
            for j in range(i + 1, 5):
                pair[(DIMS[i], dv[i], DIMS[j], dv[j])] += 1
    print(f"{n} rows, {time.time()-t0:.1f}s", flush=True)
print("scan done", n, f"{time.time()-t0:.1f}s", flush=True)
if os.path.exists(out): os.remove(out)
o = sqlite3.connect(out)
o.execute("CREATE TABLE agg_core(customer_id, project_id, event_date, day_idx INT, week INT, event_type, env, is_nfr INT, n INT, qty REAL)")
o.executemany("INSERT INTO agg_core VALUES (?,?,?,?,?,?,?,?,?,?)",
              ((k[0], k[1], k[2], dinfo(k[2])[0], dinfo(k[2])[1], k[3], k[4], k[5], v[0], v[1]) for k, v in core.items()))
o.execute("CREATE TABLE agg_dim(dim, customer_id, project_id, week INT, event_type, value, n INT, qty REAL)")
o.executemany("INSERT INTO agg_dim VALUES (?,?,?,?,?,?,?,?)", ((*k, v[0], v[1]) for k, v in dimagg.items()))
o.execute("CREATE TABLE dim_nfr(dim, value, is_nfr INT, n INT)")
o.executemany("INSERT INTO dim_nfr VALUES (?,?,?,?)", ((*k, v) for k, v in dim_nfr.items()))
o.execute("CREATE TABLE dim_etype(dim, value, event_type, n INT)")
o.executemany("INSERT INTO dim_etype VALUES (?,?,?,?)", ((*k, v) for k, v in dim_etype.items()))
o.execute("CREATE TABLE dim_env(dim, value, env, n INT)")
o.executemany("INSERT INTO dim_env VALUES (?,?,?,?)", ((*k, v) for k, v in dim_env.items()))
o.execute("CREATE TABLE dim_pair(dim_a, val_a, dim_b, val_b, n INT)")
o.executemany("INSERT INTO dim_pair VALUES (?,?,?,?,?)", ((*k, v) for k, v in pair.items()))
o.execute("CREATE TABLE env_x(event_env, project_env, customer_env, n INT)")
o.executemany("INSERT INTO env_x VALUES (?,?,?,?)", ((*k, v) for k, v in env_x.items()))
for idx in ["CREATE INDEX i1 ON agg_core(customer_id)", "CREATE INDEX i2 ON agg_dim(dim, customer_id)"]:
    o.execute(idx)
o.commit(); o.close()
prof = {"rows": n, "nulls": dict(nulls), "empties": dict(empties),
        "distinct": {c: len(s) for c, s in distinct.items()},
        "values": {c: sorted([str(x) for x in s])[:60] for c, s in distinct.items() if len(s) <= 60},
        "qstats": {et: {"min": s[0], "max": s[1], "sum": s[2], "count": s[3], "distinct_capped": len(qdistinct[et])} for et, s in qstats.items()},
        "bad": dict(bad), "elapsed_s": time.time() - t0}
json.dump(prof, open(prof_out, "w"), indent=1, default=str)
print(json.dumps(prof, indent=1, default=str)[:4000])
