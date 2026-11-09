"""Name/domain join between CRM accounts and analytics customers (no shared key)."""
import re, collections
LEGAL = r"\b(group|llc|ltd|inc|healthcare)\b"
CUST_SUF = r"(-prod|prod|-cloud|-trial|-us|-eu|-sandbox|-holdings|-health-group)$"
def alnum(s): return re.sub(r"[^a-z0-9]", "", s.lower())
def crm_name_key(name):
    n = re.sub(r"\s*-\s*(north|south|east|west)$", "", name.lower())
    return alnum(re.sub(LEGAL, "", n))
def crm_domain_key(domain):
    return alnum(re.sub(r"\.example$", "", domain.lower())) if domain else None
def cust_name_key(cname): return alnum(re.sub(CUST_SUF, "", cname.lower()))
def cust_domain_key(domain):
    if not domain: return None
    d = re.sub(r"\.example$", "", domain.lower())
    d = re.sub(r"customers$", "", d)
    return alnum(d)
def billing_key(email): return alnum(re.sub(r"\.example$", "", email.split("@", 1)[1].lower()))
def build(accounts, customers):
    """accounts: list of (id, name, domain); customers: list of (id, customer_name, domain, billing_email).
    Returns per-account dict: {cands: {cust_id: set(methods)}}"""
    idx = {"name": collections.defaultdict(set), "domain": collections.defaultdict(set), "billing": collections.defaultdict(set)}
    for cid, cn, dom, bill in customers:
        idx["name"][cust_name_key(cn)].add(cid)
        if cust_domain_key(dom): idx["domain"][cust_domain_key(dom)].add(cid)
        idx["billing"][billing_key(bill)].add(cid)
    out = {}
    for aid, name, dom in accounts:
        c = collections.defaultdict(set)
        nk, dk = crm_name_key(name), crm_domain_key(dom)
        for cid in idx["name"].get(nk, ()): c[cid].add("name")
        if dk:
            for cid in idx["domain"].get(dk, ()): c[cid].add("domain")
            for cid in idx["billing"].get(dk, ()): c[cid].add("billing")
        out[aid] = dict(c)
    return out
