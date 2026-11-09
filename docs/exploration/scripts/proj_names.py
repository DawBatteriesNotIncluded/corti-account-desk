import sqlite3, sys, re, collections
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
rows = an.execute("""SELECT p.id, p.customer_id, p.name, p.environment_type, p.created_at, p.last_active_at, c.customer_name
FROM projects p JOIN customers c ON c.id=p.customer_id ORDER BY p.id""").fetchall()
tails = collections.Counter()
tail_env = collections.Counter()
ex = collections.defaultdict(list)
for pid, cid, name, env, ca, la, cname in rows:
    t = name.rsplit("-", 1)[-1] if "-" in name else "(none)"
    tails[t] += 1
    tail_env[(t, env)] += 1
    if len(ex[t]) < 3: ex[t].append(f"{pid}:{name} [{cname}]")
for t, n in tails.most_common():
    print(f"{t:14s} {n:4d}  envs={ {e:c for (tt,e),c in tail_env.items() if tt==t} }  ex={ex[t]}")
print()
print("last_active_at distinct:", an.execute("SELECT last_active_at, COUNT(*) FROM projects GROUP BY 1").fetchall())
print("created_at range:", an.execute("SELECT MIN(created_at), MAX(created_at), COUNT(DISTINCT created_at) FROM projects").fetchall())
print("dup names:", an.execute("SELECT name, COUNT(*) FROM projects GROUP BY 1 HAVING COUNT(*)>1").fetchall())
