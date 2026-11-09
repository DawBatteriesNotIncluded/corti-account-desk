import sqlite3, sys
path = sys.argv[1]
con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
sql_all = sys.stdin.read()
for sql in [s.strip() for s in sql_all.split(";;") if s.strip()]:
    print(">>>", " ".join(sql.split())[:160])
    try:
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchall()
        print(" | ".join(cols))
        for r in rows[:60]:
            print(" | ".join("NULL" if v is None else str(v) for v in r))
        if len(rows) > 60: print(f"... ({len(rows)} rows)")
    except Exception as e:
        print("ERR", e)
    print()
