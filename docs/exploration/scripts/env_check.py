import sqlite3, sys, collections
sys.path.insert(0, sys.argv[3])
from common import project_class, project_suffix
an = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(sys.argv[2])
print("env crosstab (event_env, project_env, customer_env, n):")
for r in ag.execute("SELECT * FROM env_x ORDER BY n DESC"): print("  ", r)
proj = {pid: (cid, name, env) for pid, cid, name, env in an.execute("SELECT id, customer_id, name, environment_type FROM projects")}
# request events by event env x name class x suffix
tot = collections.Counter(); bysuf = collections.Counter(); nfr = collections.Counter()
for pid, et, env, isnfr, n, q in ag.execute("SELECT project_id, event_type, env, is_nfr, SUM(n), SUM(qty) FROM agg_core GROUP BY 1,2,3,4"):
    cls = project_class(proj[pid][1]); suf = project_suffix(proj[pid][1])
    tot[(et, env, cls, isnfr)] += q
    bysuf[(et, suf)] += q
    nfr[(et, isnfr)] += n
for et in ["request", "tokens", "transcribe"]:
    p_all = sum(v for (e, env, c, f), v in tot.items() if e == et and env == "PRODUCTION")
    p_np = sum(v for (e, env, c, f), v in tot.items() if e == et and env == "PRODUCTION" and c == "nonprod")
    s_all = sum(v for (e, env, c, f), v in tot.items() if e == et and env == "SANDBOX")
    print(f"{et}: PRODUCTION-labelled qty={p_all:,.0f}; of which name-classified nonprod={p_np:,.0f} ({p_np/p_all:.1%}); SANDBOX-labelled qty={s_all:,.0f}")
    print(f"   nfr share (rows): {nfr[(et,1)]/(nfr[(et,0)]+nfr[(et,1)]):.2%}")
print("\nrequest qty by project suffix:")
req_tot = sum(v for (e, s), v in bysuf.items() if e == "request")
nproj = collections.Counter(project_suffix(p[1]) for p in proj.values())
for (e, s), v in sorted(bysuf.items(), key=lambda x: -x[1]):
    if e == "request": print(f"   {s:10s} {v:10,.0f} {v/req_tot:6.1%}  projects={nproj[s]}  per-project={v/nproj[s]:,.0f}")
