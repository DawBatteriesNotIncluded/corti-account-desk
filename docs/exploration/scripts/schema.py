import sqlite3, sys
for path in sys.argv[1:]:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    print("=" * 20, path.split("/")[-1])
    for (name, sql) in con.execute("SELECT name, sql FROM sqlite_master WHERE type IN ('table','view','index') ORDER BY type, name"):
        print(sql or f"-- {name}")
        if sql and sql.upper().startswith("CREATE TABLE"):
            n = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            print(f"-- rows: {n}\n")
