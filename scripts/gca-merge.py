"""Join archived frozen choices to the last few hours of settled public results."""
import hashlib
import json
import math
from pathlib import Path
import sys

HOLD = 48 * 3600
ARCHIVE_CUTOFF = 1794922254
CUTOFF = 1794947578
FIELDS = ("forecastId", "poolId", "status", "reason", "observedReturnProxy", "observedRevenueProxy", "feeWindowEvidence")

def reference(part):
    ds = sorted((d for d in part["decisions"] if ARCHIVE_CUTOFF-HOLD-7200 <= d["at"] <= CUTOFF-HOLD), key=lambda d:d["at"])
    ids = {fid for d in ds for fid in d["choices"].values() if fid}
    es = {e["forecastId"]:{k:e.get(k) for k in FIELDS} for e in part["evaluations"] if e["forecastId"] in ids}
    assert ids == set(es)
    sha = hashlib.sha256(json.dumps([ds,es], sort_keys=True, separators=(",",":")).encode()).hexdigest()
    return sha, ds, es

if __name__ == "__main__":
    public = json.loads(Path(sys.argv[1]).read_text())
    sha, ds, es = reference(public)
    if len(sys.argv) == 2:
        print(sha)
        sys.exit(0)
    assert sha == sys.argv[4], "The cited public results have changed since the audit started"
    data = json.loads(Path(sys.argv[2]).read_text())
    m, picks = data["metadata"], data["picks"]
    assert m["cutoff"] == ARCHIVE_CUTOFF and m["decisionCutoff"] == CUTOFF
    archived = {d["at"]:d["choices"] for d in data["decisions"]}
    assert all(archived[d["at"]] == d["choices"] for d in ds)
    strict_tail = {t for t in archived if t > ARCHIVE_CUTOFF-HOLD}
    assert strict_tail <= {d["at"] for d in ds}
    assert all(picks[k]["poolId"] == v["poolId"] for k,v in es.items())
    checked = mismatches = 0
    for e in public["evaluations"]:
        p = picks.get(e["forecastId"])
        if not p or p["dueAt"]+2700>ARCHIVE_CUTOFF or p["status"]!="proxy" or e["status"]!="proxy": continue
        checked += 1
        if not math.isclose(p["observedReturnProxy"],e["observedReturnProxy"],rel_tol=1e-11,abs_tol=1e-11):
            mismatches += 1
    assert checked and not mismatches, "Archived historical replay differs from production"
    added=0
    for fid, e in es.items():
        p = picks[fid]
        if p["dueAt"]+2700 <= ARCHIVE_CUTOFF: continue
        p.update(status=e["status"], reason="complete" if e["status"]=="proxy" else e["reason"],
                 observedReturnProxy=e["observedReturnProxy"],observedRevenueProxy=e["observedRevenueProxy"],
                 feeWindowEvidence=e["feeWindowEvidence"], eligibleAtOutcomeUsd=None, outcomeSource="captured production tail")
        added += 1
    m.update(cutoff=CUTOFF,archiveCutoff=ARCHIVE_CUTOFF,tailDecisionCount=len(strict_tail),
             publicOutcomesUsed=added, archivedOutcomesAgreed=checked, liveMismatches=mismatches,publicReferenceSha256=sha)
    Path(sys.argv[3]).write_text(json.dumps(data,separators=(",",":")))
    print(json.dumps(m))
