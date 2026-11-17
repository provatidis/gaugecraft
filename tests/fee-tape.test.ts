import test from "node:test";
import assert from "node:assert/strict";
import {
  concatHex,
  encodeAbiParameters,
  padHex,
  parseAbiParameters,
  toHex,
  type Hex,
} from "viem";
import { demoSnapshot } from "../server/demo.js";
import { readFeeTape, supportedFeeTape } from "../server/sources/fee-tape.js";
import type { Snapshot } from "../src/shared/types.js";

const pool = "0x4a7af46bc8abc00048c6c7920a1488daf568366c";
const factory = "0x9cb220581b91b0c83223012fe69688b92ad07a76";
const tape = "0x27d5eb73e7406675f6b0cbd037490ec3dba935a4";
const hook = "0xc0ed888afe87ed1acf01d9f19bb850159e3ce434";
const weth = "0x4200000000000000000000000000000000000006";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const at = 1794940200;
const s: Snapshot = {
  ...demoSnapshot(at),
  mode: "live",
  chainId: 8453,
  id: `8453:${pool}`,
  address: pool,
  poolType: 50,
  token0: { address: weth, decimals: 18, symbol: "WETH" },
  token1: { address: usdc, decimals: 6, symbol: "USDC" },
  block: "58749123",
  blockHash:
    "0xd879d4c9f7d854ecf9816a64a8e4436710fdac84b84cd709695ce4d08f83a002",
};
const word = (v: bigint | number) => toHex(v, { size: 32 });

test("the fee tape requires the validated pool, token order, decimals, chain and live namespace", () => {
  assert.equal(supportedFeeTape(s), true);
  for (const change of [
    { mode: "demo" as const },
    { chainId: 10 },
    { poolType: 0 },
    { address: usdc },
    { id: `8453:${weth}` },
    { token0: s.token1 },
    { token1: { ...s.token1, decimals: 18 } },
  ])
    assert.equal(supportedFeeTape({ ...s, ...change }), false);
});

test("canonical tape reads use gross counters once and reject a changed writer, reference block or unwarmed tape", async (t) => {
  const acc = [
    at - 3,
    at - 5,
    323,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    9007199254740993n,
    180,
    0,
    0,
    0,
    0,
    0,
    15,
    13,
  ];
  const values: Hex[] = [
    word(8453),
    word(BigInt(s.block)),
    word(at),
    padHex(factory),
    padHex(tape),
    padHex(hook),
    padHex(hook),
    padHex(weth),
    padHex(usdc),
    concatHex(acc.map(word)),
  ];
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      const request = JSON.parse(String(options.body));
      assert.equal(request.method, "eth_call");
      assert.deepEqual(request.params[1], {
        blockHash: s.blockHash,
        requireCanonical: true,
      });
      const data = encodeAbiParameters(
        parseAbiParameters("(bool success,bytes returnData)[]"),
        [values.map((returnData) => ({ success: true, returnData }))],
      );
      return Response.json({ jsonrpc: "2.0", id: request.id, result: data });
    },
  );
  assert.deepEqual(await readFeeTape(s), {
    tape,
    blockHash: s.blockHash,
    fee0: "9007199254740993",
    fee1: "180",
    lastSwapAt: at - 3,
  });
  assert.equal(fetch.mock.callCount(), 1);
  for (const index of [3, 4, 5, 6, 7, 8]) {
    const original = values[index];
    values[index] = padHex(pool);
    await assert.rejects(readFeeTape(s), /routing changed/);
    values[index] = original;
  }
  await assert.rejects(
    readFeeTape({ ...s, observedAt: at + 1 }),
    /block does not match/,
  );
  acc[1] = 1;
  acc[2] = 0;
  values[9] = concatHex(acc.map(word));
  await assert.rejects(readFeeTape(s), /valid swap/);
});
