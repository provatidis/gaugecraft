import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {setTimeout as pause} from "node:timers/promises";
import {Store} from "../server/store.js";
import {feeTapeReader} from "../server/fee-tape-evidence.js";
import {supportedFeeTape, readFeeTape} from "../server/sources/fee-tape.js";
import {feeTapeBounds, tapeEligibleFees} from "../src/analysis/fee-window.js";
import {evaluateForecast} from "../src/analysis/forecast.js";
import type {Forecast, FeeTapePoint, Snapshot} from "../src/shared/types.js";

const [dbPath, output, flag] = process.argv.slice(2);
if (!dbPath || !output || (flag && flag !== "--base-rpc"))
  throw new Error("Usage: gca-history.ts RESTORED_DB OUTPUT_JSON [--base-rpc]");
const store = new Store(dbPath, {readOnly:true});
const horizon = 48*3600;
const rules = ["persistence","highestFees","highestRewards","highestApr"];
const counters = {needed:0,alreadyInDatabase:0,attempted:0,verified:0,failed:0,attempts:0,eligibleForecasts:0,recoveredForecasts:0};
const points = new Map<string,FeeTapePoint>();
const needed = new Map<string,Snapshot>();
const databaseLookup = feeTapeReader(store.db);
const lookup = (s:Snapshot) => points.get(s.blockHash) ?? databaseLookup(s);
const errorKinds: Record<string,number> = {};
try {
  const newest = Number(store.db.prepare("SELECT max(at) t FROM snapshots WHERE mode='live'").get()!.t);
  const finished = Number(store.db.prepare("SELECT max(finishedAt) t FROM runs WHERE mode='live'").get()!.t);
  const cutoff = Math.max(newest, finished);
  const decisionCutoff = process.env.AUDIT_DECISIONS_THROUGH ? Number(process.env.AUDIT_DECISIONS_THROUGH) : cutoff;
  assert(Number.isSafeInteger(decisionCutoff) && decisionCutoff>0, "AUDIT_DECISIONS_THROUGH must be Unix seconds");
  const allRows = store.db.prepare("SELECT at,bucket,body FROM decisions WHERE mode='live' ORDER BY at,bucket").all();
  const decisions = allRows.filter(row => Number(row.at)+horizon<=decisionCutoff).map(row=>({
    at:Number(row.at),bucket:Number(row.bucket),
    choices:JSON.parse(String(row.body)) as Record<string,string|null>,
    invalidChoices:[] as string[]
  }));
  const ids = new Set(decisions.flatMap(d=>rules.map(r=>d.choices[r])).filter((s):s is string=>Boolean(s)));
  const forecasts = new Map<string,Forecast>();
  const groups = new Map<string,Forecast[]>();
  const absentIds: string[] = [];
  for (const id of ids) {
    const f = store.forecastById("live", id, false);
    if (!f) { absentIds.push(id); continue; }
    assert.equal(f.id,id);
    assert.equal(f.input.mode,"live");
    assert.equal(f.poolId,f.input.id);
    assert.equal(f.dueAt-f.madeAt,horizon);
    forecasts.set(id,f);
    const key=f.poolId+"|"+Math.floor(f.madeAt/86400);
    const group=groups.get(key)??[];
    group.push(f);groups.set(key,group);
  }
  for(const d of decisions) {
    for(const key of rules) {
      const f=forecasts.get(d.choices[key]??"");
      if(f && Math.max(f.madeAt,f.input.retrievedAt,f.input.observedAt)>d.at) d.invalidChoices.push(key);
    }
  }
  const picks: Record<string,unknown> = {};
  function groupHistory(group:Forecast[]) {
    return store.history("live",group[0].poolId,
      Math.min(...group.map(f=>f.madeAt))-2700,
      Math.min(cutoff,Math.max(...group.map(f=>f.dueAt))+2700),false);
  }
  // During the first pass collect only endpoints actually needed by the unchanged evaluator.
  const previouslyMissing = new Set<string>();
  const foundInDb = new Set<string>();
  for (const group of groups.values()) {
    if (!supportedFeeTape(group[0].input)) continue;
    const history=groupHistory(group);
    for (const f of group) {
      const e=evaluateForecast(f,history,cutoff,lookup);
      if (e.status!=="insufficient" || !/verified fee counters are unavailable|no priced eligible-fee total/.test(e.reason)) continue;
      const end=history.find(s=>s.observedAt>=f.dueAt && s.observedAt<=f.dueAt+2700);
      if (!end || end.programs===null || end.stakedFraction===null) continue;
      const bounds=feeTapeBounds(f,history);
      if (!bounds) continue;
      const cover=history.filter(s=>s.observedAt>=bounds.start.observedAt && s.observedAt<=end.observedAt);
      if (cover.some(s=>s.allocation===null)) continue;
      previouslyMissing.add(f.id);
      for(const s of [bounds.start,bounds.end]) {
        if(databaseLookup(s)) foundInDb.add(s.blockHash);
        else needed.set(s.blockHash,s);
      }
    }
  }
  counters.needed=needed.size;counters.alreadyInDatabase=foundInDb.size;counters.eligibleForecasts=previouslyMissing.size;
  if (flag==="--base-rpc") {
    const pending=[...needed.values()];
    async function obtain(s:Snapshot) {
      counters.attempted++;
      for(let attempt=1;attempt<=3;attempt++) {
        try {
          counters.attempts++;
          const p=await readFeeTape(s,AbortSignal.timeout(17000));
          if (p.blockHash!==s.blockHash) throw Error("Wrong block");
          points.set(s.blockHash,p);counters.verified++;return;
        } catch(error) {
          const message=(error as Error).message;
          // Instrument validation failures are deterministic. Retry only an unavailable RPC call.
          const intrinsic=/No valid swap|does not match|pool, tokens or routing changed|Missing fee tape source|Unsupported fee tape/.test(message);
          if (intrinsic || attempt===3) {
            const kind=intrinsic?"instrument or block validation":/429|rate limit/i.test(message)?"rate limit":"archive RPC unavailable";
            errorKinds[kind]=(errorKinds[kind]??0)+1;
            counters.failed++;return;
          }
          await pause(attempt*750);
        }
      }
    }
    for(let i=0;i<pending.length;i+=4) {
      await Promise.all(pending.slice(i,i+4).map(obtain));
      if(i%160===0 || i+4>=pending.length) console.log("Base archive evidence:",i+Math.min(4,pending.length-i),"/",pending.length,"verified",counters.verified);
      if(i+4<pending.length) await pause(60);
    }
  }
  for (const group of groups.values()) {
    const history=groupHistory(group);
    for(const f of group) {
      const e=evaluateForecast(f,history,cutoff,lookup);
      if (e.status==="proxy" && e.feeWindowEvidence && previouslyMissing.has(f.id)) counters.recoveredForecasts++;
      const start=f.input;
      const anchor=history.findLast(s=>s.observedAt<=f.madeAt && f.madeAt-s.observedAt<=2700);
      const end=history.find(s=>s.observedAt>=f.dueAt && s.observedAt<=f.dueAt+2700);
      const cover=anchor && end ? history.filter(s=>s.observedAt>=anchor.observedAt&&s.observedAt<=end.observedAt):[];
      const eligibleAtOutcomeUsd=e.status!=="proxy" || !end ? null : e.feeWindowEvidence
        ? (tapeEligibleFees(f,cover,end,lookup)?.eligible??null)
        : end.eligibleFees48hUsd;
      picks[f.id]={
        poolId:f.poolId,label:start.token0.symbol+"/"+start.token1.symbol,chain:start.chain,
        madeAt:f.madeAt,dueAt:f.dueAt,model:f.model,status:e.status,reason:e.status==="proxy"?"complete":e.reason,
        observedReturnProxy:e.observedReturnProxy,observedRevenueProxy:e.observedRevenueProxy,eligibleAtOutcomeUsd,
        feeWindowEvidence:e.feeWindowEvidence??null,
        atSelection:{observedAt:start.observedAt,retrievedAt:start.retrievedAt,windowStart:start.windowStart,windowEnd:start.windowEnd,
          active:start.active,basis:f.basis,tvlUsd:start.tvlUsd,allocation:start.allocation,grossFees:start.grossFees48hUsd,
          eligibleFees:start.eligibleFees48hUsd,incentives:start.incentives48hUsd,rewards:start.rewards48hUsd,stakeApr:start.stakeApr,
          projectedAllocation:f.projectedAllocation,medianAllocation48h:f.medianAllocation48h??null,
          projectedFees:f.projectedFees,projectedIncentives:f.projectedIncentives,
          expectedPer1000:f.expectedPer1000,stressedPer1000:f.stressedPer1000,inputCount:f.inputCount,historyHours:f.historyHours,
          signals:f.signals.map(s=>[s.name,s.value,s.severity]),warnings:f.warnings},
        endpoint:end?{observedAt:end.observedAt,windowStart:end.windowStart,windowEnd:end.windowEnd,stakeApr:end.stakeApr,
          allocation:end.allocation,eligibleFees:end.eligibleFees48hUsd,observationCount:cover.length}:null
      };
    }
  }
  const metadata={cutoff,decisionCutoff,newest,finished,totalSaved:allRows.length,immature:allRows.length-decisions.length,matureSaved:decisions.length,
    firstSaved:Number(allRows[0]?.at)||null,latestSaved:Number(allRows.at(-1)?.at)||null,missingForecasts:absentIds,
    forecasts:forecasts.size,decisionsWithPostCutoffInputs:decisions.filter(d=>d.invalidChoices.length).length,
    feeTape:{...counters,errorKinds}};
  await writeFile(output,JSON.stringify({metadata,decisions,picks}),{flag:"wx",mode:0o600});
  console.log(JSON.stringify(metadata));
} finally {store.close();}
