import { createPublicClient, http, parseAbi, type Hash } from "viem";
import type { FeeTapePoint, Snapshot } from "../../src/shared/types.js";
import { chains } from "./aero.js";
export type { FeeTapePoint } from "../../src/shared/types.js";

// Validated Base CL50 instrument. A new tape, writer, pool or token pair
// requires an independent source check before using the same return measure.
const pool = "0x4a7af46bc8abc00048c6c7920a1488daf568366c";
const factory = "0x9cb220581b91b0c83223012fe69688b92ad07a76";
const tape = "0x27d5eb73e7406675f6b0cbd037490ec3dba935a4";
const hook = "0xc0ed888afe87ed1acf01d9f19bb850159e3ce434";
const weth = "0x4200000000000000000000000000000000000006";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const multicall = "0xca11bde05977b3631167028862be2a173976ca11";
const base = chains.find((chain) => chain.id === 8453)!;
const abi = parseAbi([
  "function getChainId() view returns(uint256)",
  "function getBlockNumber() view returns(uint256)",
  "function getCurrentBlockTimestamp() view returns(uint256)",
  "function factory() view returns(address)",
  "function clPoolTape() view returns(address)",
  "function getPoolSwapHook(address pool) view returns(address)",
  "function allowedCaller(address pool) view returns(address)",
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function accumulators(address pool) view returns(Accumulator)",
  "struct Accumulator { uint40 lastSwapTimestamp; uint40 lastObservationTimestamp; uint32 swapCount; int24 lastTick; int24 intervalMaxTick; int24 intervalMinTick; int24 intervalOpenTick; uint48 volatilityCorrob; uint120 cumulativeVolume0; uint120 cumulativeVolume1; uint16 intervalSwapCount; uint120 cumulativeFee0; uint120 cumulativeFee1; uint8 volatilityRingHead; uint8 volatilityRingCount; uint120 cumulativeMevVolume0; uint120 cumulativeMevVolume1; uint8 nOver; uint120 cumulativeMevFee0; uint120 cumulativeMevFee1; }",
]);

export function supportedFeeTape(s: Snapshot): boolean {
  return (
    s.mode === "live" &&
    s.chainId === 8453 &&
    s.id === `8453:${pool}` &&
    s.address.toLowerCase() === pool &&
    s.poolType === 50 &&
    s.token0.address.toLowerCase() === weth &&
    s.token0.decimals === 18 &&
    s.token1.address.toLowerCase() === usdc &&
    s.token1.decimals === 6
  );
}

export async function readFeeTape(
  s: Snapshot,
  signal?: AbortSignal,
): Promise<FeeTapePoint> {
  if (!supportedFeeTape(s)) throw new Error("Unsupported fee tape pool");
  if (
    !/^0x[\da-f]{64}$/i.test(s.blockHash) ||
    !/^\d+$/.test(s.block) ||
    !Number.isSafeInteger(s.observedAt) ||
    s.observedAt <= 0
  )
    throw new Error("Missing fee tape source block");

  const client = createPublicClient({
    transport: http(process.env.RPC_8453 || base.rpc, {
      timeout: 15000,
      retryCount: 0,
      fetchOptions: { signal },
    }),
  });
  const [
    chain,
    number,
    at,
    poolFactory,
    activeTape,
    activeHook,
    writer,
    token0,
    token1,
    a,
  ] = await client.multicall({
    multicallAddress: multicall,
    blockHash: s.blockHash as Hash,
    requireCanonical: true,
    allowFailure: false,
    contracts: [
      { address: multicall, abi, functionName: "getChainId" },
      { address: multicall, abi, functionName: "getBlockNumber" },
      { address: multicall, abi, functionName: "getCurrentBlockTimestamp" },
      { address: pool, abi, functionName: "factory" },
      { address: factory, abi, functionName: "clPoolTape" },
      { address: factory, abi, functionName: "getPoolSwapHook", args: [pool] },
      { address: tape, abi, functionName: "allowedCaller", args: [pool] },
      { address: pool, abi, functionName: "token0" },
      { address: pool, abi, functionName: "token1" },
      { address: tape, abi, functionName: "accumulators", args: [pool] },
    ],
  });
  if (
    chain !== 8453n ||
    number !== BigInt(s.block) ||
    at !== BigInt(s.observedAt)
  )
    throw new Error("Fee tape block does not match the recorded observation");
  if (
    poolFactory.toLowerCase() !== factory ||
    activeTape.toLowerCase() !== tape ||
    activeHook.toLowerCase() !== hook ||
    writer.toLowerCase() !== hook ||
    token0.toLowerCase() !== weth ||
    token1.toLowerCase() !== usdc
  )
    throw new Error("Fee tape pool, tokens or routing changed");
  // Before its first swap the tape warms storage with ones, including fee0.
  if (
    a.swapCount === 0 ||
    a.lastObservationTimestamp <= 1 ||
    a.lastSwapTimestamp < a.lastObservationTimestamp ||
    a.lastSwapTimestamp > s.observedAt
  )
    throw new Error("No valid swap recorded by this fee tape");
  // DynamicSwapFeeHook records the full input fee in cumulativeFee0/1.
  // The separate MEV fee counters attribute part of that same amount.
  return {
    tape,
    blockHash: s.blockHash.toLowerCase(),
    fee0: a.cumulativeFee0.toString(),
    fee1: a.cumulativeFee1.toString(),
    lastSwapAt: a.lastSwapTimestamp,
  };
}
