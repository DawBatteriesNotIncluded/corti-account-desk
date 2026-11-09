import re, datetime
REF = datetime.date(2025, 3, 14)
BASE = datetime.date(2024, 12, 15)   # first usage day (Sunday); week = (d-BASE)//7 ; wk 12 = Mar 9-14 (6 days, partial)
NONPROD_RE = re.compile(r"-(staging|qa|internal|sandbox|test|trial|dev|eval|demo)\d*$")
def project_suffix(name):
    m = re.search(r"-([a-z]+)(\d*)$", name)
    if name.endswith("-entity-a") or name.endswith("-entity-b"):
        return "entity"
    return m.group(1) if m else "(none)"
def project_class(name):
    """Name-based environment: 'nonprod' when the suffix says staging/qa/internal/sandbox/test/trial/eval; else 'prod'."""
    return "nonprod" if NONPROD_RE.search(name) else "prod"
