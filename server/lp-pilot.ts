import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { r2Storage, type ObjectStorage } from "./object-backup.js";
import { BaseLpReader } from "./sources/base-lp.js";
import {
  DAY,
  WEEK,
  pools,
  presets,
  quote,
  choices,
  value,
  stableCounters,
  unitValues,
  type Point,
  type Terms,
  type Decision,
  type PilotView,
  type Frequency,
  type Entry,
  type Choice,
  type Quote,
  type Counter,
} from "../src/analysis/liquidity.js";

export interface Frozen {
  decision: Decision;
  point: Point;
  terms: Record<string, Terms>;
  counters: Record<string, Counter>;
}
export interface Ledger {
  version: 1;
  days: Frozen[];
}
const objectKey = "lp-pilot/base-v1/latest.json";
export function decodeLedger(body: string): Ledger {
  const data = JSON.parse(body);
  if (
    data.version !== 1 ||
    !Array.isArray(data.days) ||
    data.days.length > 28 ||
    data.days.some(
      (x: Frozen, i: number) =>
        !x.point?.hash ||
        x.decision?.hash !== x.point.hash ||
        !Array.isArray(x.decision.entries) ||
        !Array.isArray(x.decision.quotes) ||
        (i && x.decision.at <= data.days[i - 1].decision.at),
    )
  )
    throw new Error("Invalid LP archive");
  return data;
}
export async function restoreLedger(storage: ObjectStorage, key = objectKey) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await storage.read(key)) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("LP archive exceeds limit");
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return { body, ledger: decodeLedger(body) };
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function verifyLedger(
  storage: ObjectStorage,
  file: string,
  body: string,
) {
  // Keep generations recoverable even if a later latest write is interrupted.
  const key = "lp-pilot/base-v1/generations/" + hash(body) + ".json";
  await storage.put(key, file);
  const restored = await restoreLedger(storage, key);
  if (restored.body !== body)
    throw new Error("LP generation failed restore comparison");
  await storage.put(objectKey, file);
  if ((await restoreLedger(storage)).body !== body)
    throw new Error("LP latest failed restore comparison");
}
export async function freeze(
  reader: BaseLpReader,
  series: Point[],
  clock = () => Math.floor(Date.now() / 1000),
): Promise<Frozen> {
  const point = series.at(-1)!;
  const terms = await reader.terms(point);
  const quotes: Quote[] = [];
  for (const pool of pools)
    for (const width of [4, 8, 16, 32]) {
      if (!terms[pool.address]) continue;
      const q = quote(pool, width, point, series, terms[pool.address], true);
      if (q) quotes.push(q);
    }
  if (!quotes.length) throw new Error("No complete seven-day LP observations");
  const entries: Entry[] = [];
  for (const asset of ["WETH", "cbBTC"] as const)
    for (const preset of Object.keys(presets) as Frequency[]) {
      const { pick, headline } = choices(quotes, asset, preset, 1000);
      entries.push({ asset, preset, pick, headline });
    }
  const counters = await reader.counters(quotes, point);
  const published = clock();
  if (published - point.at > 900)
    throw new Error("LP decision inputs expired during collection");
  return {
    point,
    terms,
    counters,
    decision: {
      at: point.at,
      block: point.block,
      hash: point.hash,
      published,
      quotes,
      entries,
    },
  };
}
export async function score(
  reader: BaseLpReader,
  frozen: Frozen,
  series: Point[],
): Promise<Decision> {
  const { point, decision } = frozen,
    end = series.at(-1)!;
  if (
    Math.abs(series[0].at - point.at) > 2 ||
    Math.abs(end.at - point.at - WEEK) > 3
  )
    throw new Error("Outcome horizon mismatch");
  series[0] = point;
  const endTerms = await reader.terms(end);
  const endCounters = await reader.counters(decision.quotes, end);
  function evaluate(c: Choice | null) {
    const missing = {
      net: null,
      edge: null,
      hold: null,
      evidence: "unavailable",
    };
    if (!c) return missing;
    const pool = pools.find((p) => p.address === c.address)!;
    const key = c.address + "-" + c.width;
    const pair: [Counter, Counter] | undefined =
      frozen.counters[key] && endCounters[key]
        ? [frozen.counters[key], endCounters[key]]
        : undefined;
    const opening = decision.quotes.find(
      (q) => q.address === c.address && q.width === c.width,
    );
    const closing = end.samples[c.address];
    if (!opening || !closing) return missing;
    const hold =
      1000 *
      (opening.stable + opening.units * unitValues(pool, closing.sqrt).spot);
    if (c.mode === "hold")
      return { net: hold, edge: 0, hold, evidence: "token balances" };
    const terms = endTerms[c.address];
    if (!terms) return { ...missing, hold };
    const q = quote(pool, c.width, point, series, terms, false, pair, opening);
    if (!q) return { ...missing, hold };
    const net = value(q, c.mode, 1000);
    return {
      net,
      edge: net === null ? null : net - hold,
      hold,
      evidence:
        net === null
          ? "unavailable"
          : pair && stableCounters(pair, point, end, c.address)
            ? "range counters"
            : "six-hour estimate",
    };
  }
  return {
    ...decision,
    scoredAt: Math.floor(Date.now() / 1000),
    outcomeBlock: end.block,
    entries: decision.entries.map((e) => {
      const pick = evaluate(e.pick),
        apr = evaluate(e.headline);
      return {
        ...e,
        score: {
          pickNet: pick.net,
          headlineNet: apr.net,
          pickEdge: pick.edge,
          headlineEdge: apr.edge,
          hold: pick.hold,
          pickEvidence: pick.evidence,
          headlineEvidence: apr.evidence,
        },
      };
    }),
  };
}
export function schedulePilot(
  path: string,
  enabled: boolean,
  backupRunning: () => boolean,
) {
  const file = path + ".lp-v1.json",
    statusFile = file + ".status";
  const storage = process.env.BACKUP_ENABLED === "1" ? r2Storage() : null;
  let ledger: Ledger = { version: 1, days: [] },
    loaded = false,
    stopped = false,
    active: Promise<void> | null = null;
  let verified = "",
    restoredAt: number | null = null,
    next = 0;
  async function save(nextLedger: Ledger) {
    const body = JSON.stringify(nextLedger);
    await writeFile(file + ".tmp", body, { mode: 0o600 });
    await rename(file + ".tmp", file);
    ledger = nextLedger;
  }
  async function collect() {
    if (!loaded) {
      try {
        ledger = decodeLedger(await readFile(file, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        if (storage) {
          try {
            await save((await restoreLedger(storage)).ledger);
          } catch (err) {
            if ((err as { name: string }).name !== "NoSuchKey") throw err;
          }
        }
      }
      try {
        const status = JSON.parse(await readFile(statusFile, "utf8"));
        verified = status.digest;
        restoredAt = status.at;
      } catch {
        /* reverify on next successful run */
      }
      loaded = true;
    }
    const now = Math.floor(Date.now() / 1000),
      first = ledger.days[0]?.decision.at;
    // Each publication owns a UTC decision date. Missed dates stay missing.
    const day = Math.floor(now / DAY),
      opening = first === undefined || day - Math.floor(first / DAY) < 28;
    const due = ledger.days.filter(
      (x) => !x.decision.scoredAt && now >= x.decision.at + WEEK + 180,
    );
    const newDay =
      opening &&
      !ledger.days.some((x) => Math.floor(x.decision.at / DAY) === day);
    if (
      !newDay &&
      !due.length &&
      (!storage || verified === hash(JSON.stringify(ledger)))
    )
      return;
    const reader = new BaseLpReader();
    const started = Date.now(),
      cpu = process.cpuUsage();
    let changed = false;
    if (newDay || due.length) {
      const head = await reader.head();
      if (newDay && Math.floor(head.at / DAY) === day) {
        const frozen = await freeze(reader, await reader.week(head));
        await save({ ...ledger, days: [...ledger.days, frozen] });
        changed = true;
      }
      for (const old of due) {
        const near = await reader.at(head.at - 600, head, 2);
        const rate = (head.at - near.at) / (head.block - near.block);
        const target = await reader.at(old.point.at + WEEK, head, rate);
        const canonical = await reader.rpc.retry(() =>
          reader.rpc.client.getBlock({ blockNumber: BigInt(old.point.block) }),
        );
        if (canonical.hash !== old.point.hash)
          throw new Error("LP decision block changed");
        const decision = await score(reader, old, await reader.week(target));
        await save({
          ...ledger,
          days: ledger.days.map((x) => (x === old ? { ...x, decision } : x)),
        });
        changed = true;
      }
    }
    const body = JSON.stringify(ledger),
      digest = hash(body);
    if (storage && ledger.days.length && digest !== verified) {
      await verifyLedger(storage, file, body);
      const at = Math.floor(Date.now() / 1000);
      await writeFile(statusFile + ".tmp", JSON.stringify({ at, digest }), {
        mode: 0o600,
      });
      await rename(statusFile + ".tmp", statusFile);
      verified = digest;
      restoredAt = at;
      changed = true;
    }
    if (changed) {
      const used = process.cpuUsage(cpu);
      console.log(
        "Base LP pilot",
        JSON.stringify({
          days: ledger.days.length,
          rpcRequests: reader.calls,
          contractReads: reader.contractReads,
          archiveBytes: Buffer.byteLength(body),
          verifiedAt: restoredAt,
          elapsedMs: Date.now() - started,
          processCpuMs: (used.user + used.system) / 1000,
        }),
      );
    }
  }
  function tick() {
    if (!enabled || stopped || active || Date.now() < next || backupRunning())
      return;
    active = collect()
      .then(() => {
        const now = Date.now() / 1000;
        const opening =
          ledger.days.length === 0 ||
          Math.floor(now / DAY) - Math.floor(ledger.days[0].point.at / DAY) <
            27;
        const nextDay = !ledger.days.length
          ? now + 60
          : opening
            ? (Math.floor(now / DAY) + 1) * DAY + 60
            : Infinity;
        const deadlines = ledger.days
          .filter((x) => !x.decision.scoredAt)
          .map((x) => x.point.at + WEEK + 181);
        next = Math.max(
          Date.now() + 60000,
          Math.min(nextDay, ...deadlines) * 1000,
        );
      })
      .catch((e) => {
        console.error(
          "Base LP pilot retry",
          e instanceof Error ? e.name : "read failed",
          e?.shortMessage?.split("\n")[0] ??
            "LP collection or backup unavailable",
        );
        next = Date.now() + 900000;
      })
      .finally(() => {
        active = null;
      });
  }
  if (!enabled)
    active = readFile(file, "utf8")
      .then((body) => {
        ledger = decodeLedger(body);
      })
      .catch(() => {})
      .finally(() => {
        active = null;
      });
  const timer = setInterval(tick, 60000);
  timer.unref();
  tick();
  return {
    view(): PilotView {
      return {
        started: ledger.days[0]?.decision.at ?? null,
        latest: ledger.days.at(-1)?.decision ?? null,
        restoredAt,
        history: ledger.days.map(({ decision: { quotes: _, ...d } }) => d),
      };
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}
