import { strict as assert } from "node:assert";
import { Store } from "../server/store.js";
import { performance } from "../server/performance.js";
import type { Evaluation } from "../src/shared/types.js";
import { digest } from "../server/storage-codec.js";

const [dbPath, cutoffOverride] = process.argv.slice(2);
assert(dbPath, "Supply the isolated restored database");
const store = new Store(dbPath, { readOnly: true });
try {
  const sql = (q: string) => store.db.prepare(q).get()!;
  const tables = ["snapshots", "forecasts", "decisions", "raw_evidence", "fee_tape_points"];
  const counts = Object.fromEntries(tables.map(table => [table, store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? Number(sql("SELECT count(*) n FROM " + table).n) : 0]));
  const liveCounts = Object.fromEntries(["snapshots","forecasts","decisions","runs"].map(t => [t, Number(sql("SELECT count(*) n FROM "+t+" WHERE mode='live'").n)]));
  console.log(JSON.stringify({liveCounts,observationsByChain:store.db.prepare("SELECT chain_id,min(at) first,max(at) last,count(*) n FROM snapshots WHERE mode='live' GROUP BY chain_id").all()}));
  const newest = Number(sql("SELECT max(at) at FROM snapshots WHERE mode='live'").at);
  const latestRun = Number(sql("SELECT max(finishedAt) t FROM runs WHERE mode='live' AND status='success'").t || 0);
  const cutoff = cutoffOverride ? Number(cutoffOverride) : Math.max(latestRun, newest);
  const app = performance(store, "live", cutoff);
  const byId = new Map(app.evaluations.map(e => [e.forecastId,e]));
  const candidates = app.decisions.flatMap(d => ["highestFees","highestRewards","highestApr"].flatMap((key,order) => {
    const shortlist = byId.get(d.choices.persistence ?? "");
    const benchmark = byId.get(d.choices[key] ?? "");
    if (shortlist?.status !== "proxy" || benchmark?.status !== "proxy" || shortlist.poolId === benchmark.poolId) return [];
    return [{d,key,order,shortlist,benchmark}];
  }));
  candidates.sort((a,b)=>Number(!!b.benchmark.feeWindowEvidence)-Number(!!a.benchmark.feeWindowEvidence)||a.order-b.order||Number((b.benchmark.observedReturnProxy ?? 0)>0)-Number((a.benchmark.observedReturnProxy ?? 0)>0)||b.d.at-a.d.at);
  const choice=candidates[0];
  console.log(JSON.stringify({counts, latestLiveObservation:newest, latestCompletedLiveRun:latestRun, evaluationCutoff:cutoff, evaluatedDecisions:app.decisions.length, matchedDistinctPoolPairs:candidates.length}));
  assert(choice,"No complete matched decision with two distinct picks at the archived cutoff");
  const amount = (raw: string, decimals:number) => Number(BigInt(raw)) / (10 ** decimals);
  function close(a:number, b:number, name:string) {
    assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b)), name);
  }
  function replay(e: Evaluation) {
    const f = store.forecastById("live", e.forecastId)!;
    const h = store.history("live", e.poolId, f.madeAt-2700, Math.min(cutoff,f.dueAt+2700));
    const start = h.filter(s=>s.observedAt<=f.madeAt).at(-1)!;
    const end = h.find(s=>s.observedAt>=f.dueAt)!;
    const covered=h.filter(s=>s.observedAt>=start.observedAt&&s.observedAt<=end.observedAt);
    assert(covered.length>=80);
    assert(covered.every((s,i)=>s.allocation!==null&&(i===0||s.observedAt-covered[i-1].observedAt<=4500)));
    assert(end.programs);
    const verifyRaw = (s: typeof end) => {
      const hashes = store.db.prepare("SELECT input_hash,raw_hash FROM snapshots WHERE mode='live' AND pool_id=? AND at=?").get(s.id,s.observedAt)!;
      assert.equal(digest(s.raw),hashes.raw_hash);
      assert.equal(digest(s),hashes.input_hash);
      return String(hashes.raw_hash);
    };
    verifyRaw(start);
    const endpointHash=verifyRaw(end);
    let fee0 = String(end.raw.windowFee0),fee1 = String(end.raw.windowFee1),startBlock=start.block,endBlock=end.block;
    const source=e.feeWindowEvidence?"pool fee counters":"aligned trailing fee window";
    if (e.feeWindowEvidence) {
      const w=e.feeWindowEvidence;
      const get=store.db.prepare("SELECT * FROM fee_tape_points WHERE pool_id=? AND block_hash=?");
      const a=get.get(e.poolId,w.startHash)!,b=get.get(e.poolId,w.endHash)!;
      assert.equal(a.tape,b.tape);
      fee0=(BigInt(String(b.fee0))-BigInt(String(a.fee0))).toString();
      fee1=(BigInt(String(b.fee1))-BigInt(String(a.fee1))).toString();
      assert.equal(fee0,w.fee0Raw);assert.equal(fee1,w.fee1Raw);
      startBlock=w.startBlock;endBlock=w.endBlock;
    } else {
      assert(Math.abs(Number(end.raw.windowStart)-f.madeAt)<=2700&&Math.abs(Number(end.raw.windowEnd)-f.dueAt)<=2700);
    }
    const fraction=BigInt(String(end.raw.liquidity))===0n?0:Number(end.raw.gaugeLiquidity)/Number(end.raw.liquidity);
    close(fraction,end.stakedFraction!,"staked-liquidity fraction");
    const value = (raw: string, token: typeof end.token0) => BigInt(raw)===0n?0:amount(raw,token.decimals)*end.prices[token.address].usd;
    const eligible = (value(fee0,end.token0)+value(fee1,end.token1))*fraction;
    if (!e.feeWindowEvidence) close(eligible,end.eligibleFees48hUsd!,"eligible fees from raw tokens");
    const rewardAt = (t:number)=>end.programs!.reduce((total,p)=>{
      const duration=Math.max(0,Math.min(p.end,t)-Math.max(p.start,f.madeAt));
      const raw=BigInt(p.rateRaw)*BigInt(duration)/10n**18n;
      return total+(raw===0n?0:amount(raw.toString(),p.token.decimals)*p.priceUsd!);
    },0);
    const horizon=f.dueAt-f.madeAt;assert.equal(horizon,48*3600);
    let feesEarned=0,incentivesEarned=0;
    for(let i=1;i<covered.length;i++) {
      const a=covered[i-1],b=covered[i];
      const lo=Math.max(a.observedAt,f.madeAt),hi=Math.min(b.observedAt,f.dueAt);
      if(hi<=lo)continue;
      const t=(lo+hi-2*a.observedAt)/(2*(b.observedAt-a.observedAt));
      const weight=1000/(1000+(1-t)*a.allocation!+t*b.allocation!);
      feesEarned+=weight*eligible*(hi-lo)/horizon;
      incentivesEarned+=weight*(rewardAt(hi)-rewardAt(lo));
    }
    const reproduced=feesEarned+incentivesEarned;
    close(reproduced,e.observedReturnProxy!,"earnings from the underlying observations");
    close(eligible+rewardAt(f.dueAt),e.observedRevenueProxy!,"pool eligible revenue");
    return {pool:e.poolId,pair:end.token0.symbol+"/"+end.token1.symbol,chain:end.chain,forecastAt:f.madeAt,dueAt:f.dueAt,observations:covered.length,feeSource:source,startBlock,endBlock,endpointEvidenceSha256:endpointHash,fee0Raw:fee0,fee1Raw:fee1,fee0Units:amount(fee0,end.token0.decimals),fee1Units:amount(fee1,end.token1.decimals),eligibleUsd:eligible,feesEarned,incentivesEarned,reproduced,appValue:e.observedReturnProxy};
  }
  console.log(JSON.stringify({decisionAt:choice.d.at,benchmark:choice.key,shortlist:replay(choice.shortlist),comparison:replay(choice.benchmark)}));
} finally {
  store.db.close();
}
