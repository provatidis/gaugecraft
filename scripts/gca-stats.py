"""Compare original cohort choices, including timing sensitivity, without optimizing start times."""
import argparse
import bisect
import json
import math
from collections import Counter
from datetime import datetime, timezone
from statistics import median, mean

HOLD = 48 * 3600
GRACE = 2 * 3600
RULES = ("highestFees", "highestRewards", "highestApr")
SHORT = "persistence"


def utc(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat().replace("+00:00", "Z")


def pool_of(forecast_id, pick):
    if pick and pick.get("poolId"):
        return pick["poolId"]
    if forecast_id:
        pieces = forecast_id.split(":")
        if len(pieces) >= 5:
            return ":".join(pieces[1:-2])
    return None


def hold_for(forecast_id, picks):
    pick = picks.get(forecast_id) or {}
    start = pick.get("madeAt")
    if start is None:
        start = int(forecast_id.split(":")[-2])
    end = pick.get("dueAt", start + HOLD)
    if end != start + HOLD:
        raise ValueError(f"Unexpected holding period for {forecast_id}")
    return start, end


def grid_selection(rows, picks, cutoff, phase):
    # Predeclared slot selection deliberately does not reference outcomes.
    ats = [r["at"] for r in rows]
    day = (ats[0] // 86400) * 86400
    grid = day + ((phase * 3600 - day) % HOLD)
    prior_end = None
    selected, slots = [], []
    while grid <= cutoff - HOLD:
        candidates = rows[bisect.bisect_left(ats, grid):bisect.bisect_right(ats, grid + GRACE)]
        slot = {"target": grid, "reason": "no saved decision during tolerance", "rejectedOverlap": 0}
        for row in candidates:
            frozen = {fid for fid in row["choices"].values() if fid}
            holds = [hold_for(fid,picks) for fid in frozen]
            # A decision with zero saved picks still uses its slot and remains unscorable.
            begin = min((v[0] for v in holds), default=row["at"])
            end = max((v[1] for v in holds), default=row["at"] + HOLD)
            if prior_end is not None and begin < prior_end:
                slot["reason"] = "frozen holding windows overlap previous selected slot"
                slot["rejectedOverlap"] += 1
                continue
            assert end >= begin + HOLD
            slot.update({"at":row["at"],"delaySeconds":row["at"]-grid,"begin":begin,"end":end,"reason":"selected"})
            selected.append(row)
            prior_end = end
            break
        slots.append(slot)
        grid += HOLD
    return selected, slots


def count_values(c):
    return dict(c.most_common())


def why(row, key, picks):
    if key in (row.get("invalidChoices") or []):
        return "choice unavailable at selection time"
    fid = row["choices"].get(key)
    if not fid:
        return "no saved choice"
    p = picks.get(fid)
    if not p:
        return "missing frozen forecast"
    v = p.get("observedReturnProxy")
    if p.get("status") == "proxy" and isinstance(v,(int,float)) and math.isfinite(v):
        return None
    return p.get("reason") or p.get("status") or "unscorable"


def summary(rows, picks, rule, sample):
    issues = Counter()
    short_reasons, benchmark_reasons, conditional_bench_reasons = Counter(), Counter(), Counter()
    matched, distinct = [], []
    saved_both = saved_different = saved_unknown_pool = same = 0
    for row in rows:
        ch = row["choices"]
        sid, bid = ch.get(SHORT), ch.get(rule)
        sp, bp = picks.get(sid), picks.get(bid)
        spro, bpro = pool_of(sid,sp), pool_of(bid,bp)
        invalid = set(row.get("invalidChoices") or [])
        if sid and bid and SHORT not in invalid and rule not in invalid:
            saved_both += 1
            if spro and bpro:
                saved_different += int(spro != bpro)
            else:
                saved_unknown_pool += 1
        sw, bw = why(row,SHORT,picks), why(row,rule,picks)
        if sw: short_reasons[sw] += 1
        if bw: benchmark_reasons[bw] += 1
        if not sw and bw: conditional_bench_reasons[bw] += 1
        if sw or bw:
            if not sid and not bid: reason = "neither choice saved"
            elif not sid: reason = "no shortlist saved"
            elif not bid: reason = "no benchmark saved"
            elif SHORT in invalid or rule in invalid: reason = "invalid original choice time"
            elif sw and bw: reason = "both outcomes unavailable"
            elif sw: reason = "shortlist outcome unavailable"
            else: reason = "benchmark outcome unavailable"
            issues[reason] += 1
            continue
        s, b = sp["observedReturnProxy"], bp["observedReturnProxy"]
        assert spro and bpro
        rec = {"at":row["at"],"benchmark":rule,"shortlistId":sid,"benchmarkId":bid,
               "shortlistPool":spro,"benchmarkPool":bpro,"shortlistAge":row["at"]-hold_for(sid,picks)[0],
               "benchmarkAge":row["at"]-hold_for(bid,picks)[0],"shortlist":s,"rival":b,"delta":s-b,"sample":sample}
        matched.append(rec)
        if spro != bpro: distinct.append(rec)
        else: same += 1
    def numbers(records):
        if not records:
            return {"n":0,"wins":0,"ties":0,"losses":0,"winFraction":None,"medianDelta":None,"meanDelta":None,"worstDelta":None}
        def sign(r):
            if math.isclose(r["shortlist"],r["rival"],rel_tol=1e-12,abs_tol=1e-12): return 0
            return 1 if r["delta"] > 0 else -1
        signs = Counter(sign(r) for r in records)
        deltas = [r["delta"] for r in records]
        return {"n":len(deltas),"wins":signs[1],"ties":signs[0],"losses":signs[-1],
                "winFraction":signs[1]/len(deltas),"medianDelta":median(deltas),"meanDelta":mean(deltas),
                "worstDelta":min(deltas),"medianShortlist":median(r["shortlist"] for r in records),
                "medianBenchmark":median(r["rival"] for r in records),"meanShortlist":mean(r["shortlist"] for r in records),
                "meanBenchmark":mean(r["rival"] for r in records),"firstAt":min(r["at"] for r in records),"lastAt":max(r["at"] for r in records),
                "matchedUtcDays":len({utc(r["at"])[:10] for r in records})}
    def ages(records, val):
        age = sorted(val(r) for r in records)
        return {"minSeconds":min(age),"medianSeconds":median(age),"maxSeconds":max(age),
                "p95Seconds":age[math.ceil(.95*len(age))-1],
                "over5min":sum(a>300 for a in age)} if age else {}
    fresh_distinct = [r for r in distinct if max(r["shortlistAge"],r["benchmarkAge"]) <= 300]
    assert all(min(r["shortlistAge"],r["benchmarkAge"])>=0 for r in matched)
    assert len(rows) == len(matched) + sum(issues.values())
    return ({"attempts":len(rows),"bothPicksSaved":saved_both,"differentPoolsAmongSaved":saved_different,
             "unidentifiedPoolsAmongSaved":saved_unknown_pool,"matchedSamePool":same,
             "matched":numbers(matched),"matchedDistinct":numbers(distinct),"distinctWithin5min":numbers(fresh_distinct),
             "maxOriginAge":ages(matched,lambda r: max(r["shortlistAge"],r["benchmarkAge"])),
             "shortlistAge":ages(matched,lambda r:r["shortlistAge"]),
             "benchmarkAge":ages(matched,lambda r:r["benchmarkAge"]),"excluded":len(rows)-len(matched),
             "exclusions":count_values(issues),"shortlistReasons":count_values(short_reasons),
             "benchmarkReasons":count_values(benchmark_reasons),"benchmarkReasonsWithScorableShortlist":count_values(conditional_bench_reasons)},
            min(distinct,key=lambda r:(r["delta"],r["at"]),default=None))


def analyze(data):
    picks=data["picks"]
    rows=sorted(data["decisions"],key=lambda r:r["at"])
    cutoff=data["metadata"]["cutoff"]
    assert rows and all(r["at"]+HOLD<=cutoff for r in rows)
    assert len({r["at"] for r in rows})==len(rows)
    qualified=[r for r in rows if r["choices"].get(SHORT)]
    info={"earliestDecisionUtc":utc(rows[0]["at"]),"latestDecisionUtc":utc(rows[-1]["at"]),
          "cutoffUtc":utc(cutoff),"savedDecisions":len(rows),"withShortlist":len(qualified),
          "firstShortlistUtc":utc(qualified[0]["at"]) if qualified else None,
          "decisionUtcDays":len({utc(r["at"])[:10] for r in rows}),"shortlistUtcDays":len({utc(r["at"])[:10] for r in qualified})}
    worsts=[]
    def compare(selected,sample):
        metrics={}
        for rule in RULES:
            metrics[rule],worst=summary(selected,picks,rule,sample)
            if worst and sample in ("primary","all"): worsts.append(worst)
        return metrics
    def common(selected):
        complete = [r for r in selected if all(why(r,key,picks) is None for key in (SHORT,*RULES))]
        return {"n":len(complete),"rules":{rule:summary(complete,picks,rule,"common")[0]["matchedDistinct"] for rule in RULES}}
    phases=[]
    for phase in range(0,48,6):
        selected,slots=grid_selection(rows,picks,cutoff,phase)
        chosen=[s for s in slots if s["reason"]=="selected"]
        delays=[s["delaySeconds"] for s in chosen]
        assert all(a["end"]<=b["begin"] for a,b in zip(chosen,chosen[1:]))
        phases.append({"offsetHours":phase,"gridSlots":len(slots),"selected":len(selected),
                       "empty":count_values(Counter(s["reason"] for s in slots if s["reason"]!="selected")),
                       "maxDelaySeconds":max(delays,default=None),"medianDelaySeconds":median(delays) if delays else None,
                       "overlappingCandidatesSkipped":sum(s["rejectedOverlap"] for s in slots),
                       "targets":slots,"common":common(selected),"rules":compare(selected,"primary" if phase==0 else f"phase{phase}")})
    return {"window":info,"all":compare(rows,"all"),"allCommon":common(rows),"phases":phases,"worsts":worsts}


def compact(report):
    def summary_rule(s):
        distinct=s["matchedDistinct"]
        age=s["maxOriginAge"]
        return [s["bothPicksSaved"],s["differentPoolsAmongSaved"],s["matched"]["n"],s["matchedSamePool"],
                distinct["n"],distinct["wins"],distinct["ties"],distinct["losses"],distinct["medianDelta"],
                distinct["worstDelta"],age.get("medianSeconds"),age.get("maxSeconds"),age.get("over5min")]
    return {"window":report["window"],"fields":["bothSaved","differentSaved","matched","sameMatched","differentMatched","wins","ties","losses","medianDiff","worstDiff","medianOriginAgeSeconds","maxAgeSeconds","older5min"],
            "all":{rule:summary_rule(b) for rule,b in report["all"].items()},
            "primary":{rule:summary_rule(b) for rule,b in report["phases"][0]["rules"].items()},
            "primaryMissing":{rule:b["exclusions"] for rule,b in report["phases"][0]["rules"].items()},
            "allMissing":{rule:b["exclusions"] for rule,b in report["all"].items()},
            "phaseFields":["UTC offset (h)","slots","selected","delayed overlaps skipped","each rule: matched, wins, distinct, median USD difference"],
            "phases":[[p["offsetHours"],p["gridSlots"],p["selected"],p["overlappingCandidatesSkipped"],
                       *[[v["matched"]["n"],v["matchedDistinct"]["wins"],v["matchedDistinct"]["n"],v["matchedDistinct"]["medianDelta"]] for v in p["rules"].values()]] for p in report["phases"]],
            "primaryCommon":report["phases"][0]["common"],"allCommon":report["allCommon"],
            "worsts":report["worsts"]}


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--compact",action="store_true",help="Print concise comparison summary to stdout.")
    p.add_argument("history")
    p.add_argument("output",nargs="?")
    args=p.parse_args()
    with open(args.history) as f: report=analyze(json.load(f))
    if args.output:
        with open(args.output,"w") as f: json.dump(report,f,allow_nan=False)
    if args.compact or not args.output:
        print(json.dumps(compact(report) if args.compact else report,allow_nan=False))
