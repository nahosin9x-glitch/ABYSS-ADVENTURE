import type { RandomState, Stream } from "./types";
const MASK = (1n << 64n) - 1n;
export function next(r: RandomState): number {
  const old = BigInt("0x" + r.state);
  r.state = (
    (old * 6364136223846793005n + BigInt("0x" + r.inc)) &
    MASK
  ).toString(16);
  const x = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn) >>> 0,
    rot = Number(old >> 59n);
  return ((x >>> rot) | (x << (-rot & 31))) >>> 0;
}
export function rng(seed: bigint, sequence: bigint): RandomState {
  const r = { state: "0", inc: ((sequence << 1n) | 1n).toString(16) };
  next(r);
  r.state = ((BigInt("0x" + r.state) + seed) & MASK).toString(16);
  next(r);
  return r;
}
export function integer(r: RandomState, min: number, max: number): number {
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    max < min ||
    max - min >= 0x100000000
  )
    throw Error("Invalid RNG range");
  const size = max - min + 1,
    limit = Math.floor(0x100000000 / size) * size;
  let x;
  do {
    x = next(r);
  } while (x >= limit);
  return min + (x % size);
}
export function chance(r: RandomState, p: number): boolean {
  return (
    integer(r, 1, 10000) <= Math.round(Math.min(1, Math.max(0, p)) * 10000)
  );
}
export function pick<T>(r: RandomState, list: T[]): T {
  if (!list.length) throw Error("Empty choice");
  return list[integer(r, 0, list.length - 1)];
}
export function weighted(r: RandomState, weights: number[]): number {
  let n = integer(
    r,
    1,
    weights.reduce((a, b) => a + b, 0),
  );
  for (let i = 0; i < weights.length; i++) {
    n -= weights[i];
    if (n <= 0) return i;
  }
  throw Error("Invalid weights");
}
export function streams(seed: bigint): Record<Stream, RandomState> {
  return Object.fromEntries(
    ["combat", "encounter", "loot", "craft", "summon", "enhance", "daily"].map(
      (k, i) => [k, rng(seed, BigInt(i + 1))],
    ),
  ) as Record<Stream, RandomState>;
}
