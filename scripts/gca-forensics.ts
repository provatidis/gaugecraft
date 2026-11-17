import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { incentives, median } from "../src/analysis/math.js";
import type { Snapshot, Forecast } from "../src/shared/types.js";

const [dbPath, datasetPath, statsPath] = process.argv.slice(2);
if (!dbPath || !datasetPath) throw Error("Expected DB, dataset JSON, optional summary JSON");
const data = JSON.parse(readFileSync(datasetPath, "utf8"));
const report = statsPath ? JSON.parse(readFileSync(statsPath, "utf8")) : null;
const store = new Store(dbPath, {readOnly:true});
const rules = ["highestFees","highestRewards","highestApr"];
const worstByRule = new Map<string, any>();
for (const d of data.decisions) {
  const a = data.picks[d.choices.persistence];
  if (a?.status !== "proxy") continue;
  for (const benchmark of rules) {
    const b = data.picks[d.choices[benchmark]];
    if (b?.status !== "proxy" || b.poolId === a.poolId) continue;
    const delta = a.observedReturnProxy - b.observedReturnProxy;
    const previous = worstByRule.get(benchmark);
    if (!previous || previous.delta > delta)
      worstByRule.set(benchmark, {sample:"all",benchmark,at:d.at,delta,shortlistId:d.choices.persistence, benchmarkId:d.choices[benchmark]});
  }
}
const requested = [...worstByRule.values(), ...(report?.worsts || []).filter((w:any) => w.sample === "primary")];
const held = (s: Snapshot[], f: Forecast) => {
  const start=s.filter(x=>x.observedAt <= f.madeAt).at(-1), end=s.find(x=>x.observedAt >= f.dueAt);
  if (!start || !end) return null;
  return {start,end,observations:s.filter(x=>x.observedAt>=start.observedAt && x.observedAt <= end.observedAt)};
};
function describe(id:string) {
  const e = data.picks[id];
  const f = store.forecastById("live",id);
  if (!f) return {missingForecast:id,exportRecord:e};
  const s = f.input;
  const left = s.observedAt-48*3600;
  const right=f.dueAt+2700;
  const hist=store.history("live",s.id,left,right,false);
  const past=hist.filter(x=>x.observedAt<=s.observedAt && x.retrievedAt <= f.madeAt);
  const all = (key:keyof Snapshot) => past.flatMap(x=>typeof x[key] === "number"?[x[key] as number]:[]);
  const series = (v:number[])=>v.length ? {n:v.length,min:Math.min(...v),median:median(v),max:Math.max(...v),last:v.at(-1)} : null;
  const programs = (ss:Snapshot)=>ss.programs?.filter(p=>p.end>f.madeAt && p.start<f.dueAt).map(p=>({id:p.id,token:p.token.symbol,start:p.start,end:p.end,price:p.priceUsd,projectedPoolUsd:incentives([p],f.madeAt,f.dueAt)}))??null;
  const result = {id,model:f.model,chain:s.chain,name:s.token0.symbol+"/"+s.token1.symbol,basis:f.basis,tickSpacing:s.poolType,at:f.madeAt,dueAt:f.dueAt,originBlock:s.block,
    asKnown:{fees:s.eligibleFees48hUsd,rewards:s.rewards48hUsd,stakeApr:s.stakeApr,tvl:s.tvlUsd,volume:s.volume48hUsd,stakedFraction:s.stakedFraction,sourceWindowHours:(s.windowEnd-s.windowStart)/3600,allocation:s.allocation,projectedAllocation:f.projectedAllocation,projectedPoolFees:f.projectedFees,projectedPoolIncentives:f.projectedIncentives,projectedPer1000:f.expectedPer1000,stressedPer1000:f.stressedPer1000,observationCount:f.inputCount,signals:f.signals.map(x=>({name:x.name,value:x.value,severity:x.severity})),warnings:[...new Set([...f.warnings,...s.warnings])],prior48hAllocation:series(all("allocation")),prior48hEligibleFees:series(all("eligibleFees48hUsd")),programs:programs(s)}
  };
  const h=held(hist,f);
  if(!h) return {...result, outcome:{incompleteArchive:true,appValue:e.observedReturnProxy}};
  const {start,end,observations}=h;
  const inc=incentives(end.programs,f.madeAt,f.dueAt);
  const eligible=e.eligibleAtOutcomeUsd??(inc===null?null:e.observedRevenueProxy-inc);
  let feeShare=0;
  let incShare=0;
  let previousInc=0;
  let timeShare=0;
  let timeSupply=0;
  for(let i=1;i<observations.length;i++){
    const a=observations[i-1], b=observations[i];
    const lo=Math.max(f.madeAt,a.observedAt),hi=Math.min(f.dueAt,b.observedAt);
    if(hi<=lo)continue;
    assert(a.allocation!==null && b.allocation!==null);
    const elapsed=((lo+hi)/2-a.observedAt)/(b.observedAt-a.observedAt);
    const supply=a.allocation+(b.allocation-a.allocation)*elapsed;
    const share=1000/(1000+supply), duration=(hi-lo)/(f.dueAt-f.madeAt);
    const cumulative=incentives(end.programs,f.madeAt,hi);
    assert(cumulative!==null && eligible!==null);
    timeSupply+=supply*duration;
    timeShare+=share*duration;
    feeShare+=eligible*duration*share;
    incShare+=(cumulative-previousInc)*share;
    previousInc=cumulative;
  }
  if(Math.abs(e.observedReturnProxy-(feeShare+incShare)) > 1e-8*Math.max(1,Math.abs(e.observedReturnProxy))) throw Error("Independent earnings replay failed at "+id);
  return {...result,outcome:{observations:observations.length,startBlock:start.block,endBlock:end.block,observedRevenueProxy:e.observedRevenueProxy,observedPoolFees:eligible,observedPoolIncentives:inc,observedAllocationEnd:end.allocation,observedAllocationMeanTimeWeighted:timeSupply,observedAllocation:series(observations.flatMap(x=>x.allocation===null?[]:[x.allocation])),observedMeanShare:timeShare,projectedMeanShare:f.projectedAllocation===null?null:1000/(1000+f.projectedAllocation),feesPer1000:feeShare,incentivesPer1000:incShare,appValue:e.observedReturnProxy,source:e.feeWindowEvidence?"Base pool counter delta":"aligned reported fee window",programs:programs(end)}};
}
try {
 const ids=[...new Set(requested.flatMap(w=>[w.shortlistId,w.benchmarkId]))];
 console.log(JSON.stringify({worsts:requested,details:Object.fromEntries(ids.map(id=>[id,describe(id)]))},null,2));
} finally {store.close();}
