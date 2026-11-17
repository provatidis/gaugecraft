import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { performance } from "../server/performance.js";
import { feeTapeWorker } from "../server/fee-tape-evidence.js";
import { supportedFeeTape, readFeeTape } from "../server/sources/fee-tape.js";

const store = new Store(process.argv[2]);
const decisionAt = 1794747650;
try {
  const cutoff = Number(store.db.prepare("SELECT max(finishedAt) AS t FROM runs WHERE mode='live' AND status='success'").get()!.t);
  const decision = store.decisions("live", cutoff).find(d => d.at === decisionAt);
  assert(decision?.choices.highestFees && decision.choices.persistence);
  const f = store.forecastById("live", decision.choices.highestFees);
  assert(f && supportedFeeTape(f.input));
  const archived = performance(store,"live",cutoff);
  const before = archived.evaluations.find(e => e.forecastId === f.id);
  assert.equal(before?.status, "insufficient");
  const worker = feeTapeWorker(store, {
    supports: s => s.observedAt === f.input.observedAt && supportedFeeTape(s),
    read: readFeeTape,
  });
  const passes = [];
  for(let i=0;i<24;i++) {
    const pass=await worker(cutoff,AbortSignal.timeout(45000));
    passes.push(pass);
    if(pass.added>=2 || !pass.pending) break;
  }
  const replay = performance(store,"live",cutoff);
  const shortlist = replay.evaluations.find(e => e.forecastId === decision.choices.persistence);
  const result = replay.evaluations.find(e => e.forecastId === f.id);
  assert.equal(result?.status, "proxy");
  const evidence = result.feeWindowEvidence;
  assert(evidence);
  // Public production values captured for this exact immutable decision before the replay.
  assert.equal(evidence.startBlock, "57786124");
  assert.equal(evidence.endBlock, "58650123");
  assert.equal(evidence.fee0Raw, "14942622688568096972");
  assert.equal(evidence.fee1Raw, "22357072437");
  assert(Math.abs(result.observedReturnProxy! - 0.48617470612947083) < 1e-12);
  assert(Math.abs(shortlist!.observedReturnProxy! - 2.512846844590255) < 1e-12);
  console.log(JSON.stringify({decisionAt,observedAt:cutoff,passes,before:before.reason,recovered:evidence,benchmark:result.observedReturnProxy,shortlist:shortlist!.observedReturnProxy}));
} finally { store.close(); }
