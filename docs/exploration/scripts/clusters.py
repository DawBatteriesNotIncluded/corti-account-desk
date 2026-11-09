import sqlite3, sys
crm = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
an = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro&immutable=1", uri=True)
ag = sqlite3.connect(sys.argv[3])
clusters = [(["acc_010","acc_047"],["cust_010","cust_046"]), (["acc_011"],["cust_011","cust_012"]),
 (["acc_013","acc_014","acc_015","acc_062"],["cust_014","cust_061"]), (["acc_020","acc_146"],["cust_019","cust_145"]),
 (["acc_028","acc_125"],["cust_027","cust_124"]), (["acc_064","acc_137"],["cust_063","cust_136"]),
 (["acc_069","acc_152"],["cust_068","cust_151"]), (["acc_161","acc_185"],["cust_160","cust_184"])]
for accs, custs in clusters:
    print("=" * 100)
    for a in accs:
        r = crm.execute("SELECT id,name,domain,industry,employee_count,owner_id,stage,created_at,updated_at,last_contact_at,next_step,opportunity_amount,close_date,icp_tier FROM accounts WHERE id=?", (a,)).fetchone()
        print("CRM ", r)
        for o in crm.execute("SELECT id,name,stage,value,opened_at,close_date,owner_id,status FROM opportunities WHERE account_id=?", (a,)): print("     opp", o)
        doms = crm.execute("SELECT substr(email, instr(email,'@')+1) d, COUNT(*) FROM contacts WHERE account_id=? GROUP BY 1", (a,)).fetchall()
        print("     contact email domains", doms)
        for x in crm.execute("SELECT activity_type, direction, timestamp, subject, outcome, from_stage, to_stage, text FROM activities WHERE account_id=? ORDER BY timestamp", (a,)): print("     act", x)
    for c in custs:
        r = an.execute("SELECT * FROM customers WHERE id=?", (c,)).fetchone()
        print("AN  ", r)
        for p in an.execute("SELECT id,name,environment_type,created_at FROM projects WHERE customer_id=?", (c,)): print("     proj", p)
        for k in an.execute("SELECT * FROM contracts WHERE customer_id=?", (c,)): print("     contract", k)
        for h in an.execute("SELECT alert_id, alert_status, created_at FROM customer_alert_history WHERE customer_id=?", (c,)): print("     alert", h)
        u = ag.execute("SELECT MIN(event_date), MAX(event_date), SUM(CASE WHEN event_type='request' THEN qty END), COUNT(DISTINCT project_id) FROM agg_core WHERE customer_id=?", (c,)).fetchone()
        print("     usage", u)
        nk = an.execute("SELECT COUNT(*), SUM(active), MIN(created_at), MAX(created_at) FROM api_keys WHERE customer_id=?", (c,)).fetchone()
        print("     keys", nk)
