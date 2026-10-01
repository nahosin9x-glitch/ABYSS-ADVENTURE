import { content, recipeById, materialById } from "../content";
import { integer, weighted } from "../core/random";
import type { GameState, Equipment, Recipe } from "../core/types";
export const STONE = "mat_enhancement_stone";
export const amount = (v: string | undefined): bigint => BigInt(v ?? "0");
export function add(bag: Record<string, string>, id: string, n: bigint): void {
  const v = amount(bag[id]) + n;
  if (v < 0n) throw Error("Not enough resources");
  if (v === 0n) delete bag[id];
  else bag[id] = v.toString();
}
export const used = (s: GameState): bigint =>
  BigInt(
    s.equipment.filter((e) => !e.owner).length +
      Object.keys(s.materials).length,
  );
export function bagCost(s: GameState): bigint {
  const n = (amount(s.capacity) - 100n + 4n) / 5n;
  const stage = Math.min(29, 2 + Number(n));
  const roster = Math.round(content.rosterPrices[stage] * 0.7 / 100) * 100;
  const current = BigInt(Math.max(100, Math.round((Math.round(roster * 0.6 / 100) * 100) * 0.7 / 100) * 100));
  return BigInt(Math.max(100, Math.round(Number(current) * 0.7 / 100) * 100));
}
export function goldSpend(s: GameState, n: bigint): void {
  if (amount(s.gold) < n) throw Error("Not enough Gold");
  s.gold = (amount(s.gold) - n).toString();
}
export function receive(s: GameState, id: string, n: bigint): void {
  if (n <= 0n) return;
  if (s.materials[id] || used(s) < amount(s.capacity)) add(s.materials, id, n);
  else add(s.pending, id, n);
}
export function storePending(s: GameState): void {
  for (const [id, n] of Object.entries(s.pending))
    if (s.materials[id] || used(s) < amount(s.capacity)) {
      add(s.materials, id, amount(n));
      delete s.pending[id];
    }
}
const counters: [string, number, number, boolean][] = [
  ["PhysicalDR", 4, 0, false],
  ["ElementalDR", 5, 0, false],
  ["CCRes", 6, 0, false],
  ["DOTRes", 8, 0, false],
  ["DebuffRes", 7, 0, false],
  ["BurnRes", 8, 0, false],
  ["ShieldBreak", 4, 1, true],
  ["InterruptPower", 7, 1, true],
  ["DefenseBreak", 6, 1, true],
  ["AutoCleanse", 7, 1, false],
  ...[
    "Bleeding",
    "Poison",
    "Trap",
    "Doom Mark",
    "Stun",
    "Darkness",
    "Weaken",
    "Wither",
    "Skill Seal",
  ].map((n) => [n + "Res", 8, 2, false] as [string, number, number, boolean]),
];
export function rollEquipment(s: GameState, r: Recipe): Equipment {
  const rng = s.rng.craft,
    rarity = weighted(rng, content.rarityWeights[r.tier - 1]),
    name = content.rarities[rarity],
    ranges = [
      [1, 1],
      [1, 1],
      [1, 2],
      [2, 4],
      [3, 4],
      [4, 5],
      [5, 5],
      [6, 7],
    ],
    count = integer(rng, ...(ranges[rarity] as [number, number]));
  let pool = ["HP", "ATK", "MATK", "DEF", "CRIT"].map((key, i) => ({
    key,
    weight: 10,
    range:
      content.flatAffixes[
        (r.tier + "_" + name) as keyof typeof content.flatAffixes
      ][i === 0 ? 0 : i === 4 ? 2 : 1],
    kind: "core",
  }));
  for (const [key, min, group, off] of counters) {
    if (r.tier < min) continue;
    const valid =
      r.slot === "Ring"
        ? key !== "AutoCleanse"
        : r.slot === "Weapon"
          ? off
          : r.slot === "Necklace"
            ? !off
            : !off && key !== "AutoCleanse";
    if (valid)
      pool.push({
        key,
        weight: 3,
        range:
          content.counterRanges[name as keyof typeof content.counterRanges][
            group
          ],
        kind: "counter",
      });
  }
  if (["Weapon", "Ring"].includes(r.slot)) {
    if (r.tier >= 3)
      pool.push({
        key: "PoisonDamage",
        weight: 3,
        range: content.dotRanges[name as keyof typeof content.dotRanges][0],
        kind: "dot",
      });
    if (r.tier >= 8)
      pool.push({
        key: "DOTDamage",
        weight: 3,
        range: content.dotRanges[name as keyof typeof content.dotRanges][1],
        kind: "dot",
      });
  }
  const affixes: Record<string, number> = {};
  let nc = 0,
    nd = 0;
  while (Object.keys(affixes).length < count) {
    const left = count - Object.keys(affixes).length;
    const eligible = pool
      .filter((p) => p.kind !== "counter" || nc < 2)
      .filter((p) => p.kind !== "dot" || nd < 1)
      .filter((p) => {
        const rest = pool.filter((x) => x !== p),
          cc = nc + (p.kind === "counter" ? 1 : 0),
          dd = nd + (p.kind === "dot" ? 1 : 0);
        return (
          rest.filter((x) => x.kind === "core").length +
            Math.min(2 - cc, rest.filter((x) => x.kind === "counter").length) +
            Math.min(1 - dd, rest.filter((x) => x.kind === "dot").length) >=
          left - 1
        );
      });
    if (!eligible.length) throw Error("Affix pool exhausted");
    const p =
      eligible[
        weighted(
          rng,
          eligible.map((x) => x.weight),
        )
      ];
    affixes[p.key] =
      integer(rng, p.range[0], p.range[1]) / (p.kind === "core" ? 1 : 100);
    if (p.kind === "counter") nc++;
    if (p.kind === "dot") nd++;
    pool = pool.filter((x) => x !== p);
  }
  return {
    id: "item_" + s.nextId++,
    templateId: r.id,
    rarity,
    enhancement: 0,
    affixes,
    owner: null,
  };
}
export function canCraft(s: GameState, r: Recipe): boolean {
  if (r.tier > s.unlockedMap ||
      !r.ingredients.every((m) => amount(s.materials[m.id]) >= BigInt(m.quantity))) return false;
  const after = { ...s.materials };
  for (const m of r.ingredients) add(after, m.id, -BigInt(m.quantity));
  return BigInt(s.equipment.filter(e => !e.owner).length + 1 + Object.keys(after).length) <= amount(s.capacity);
}
export function craft(s: GameState, id: string): Equipment {
  const r = recipeById[id];
  if (!r || r.tier > s.unlockedMap) throw Error("Recipe locked");
  const after = { ...s.materials };
  for (const m of r.ingredients) add(after, m.id, -BigInt(m.quantity));
  if (
    BigInt(
      s.equipment.filter((e) => !e.owner).length +
        1 +
        Object.keys(after).length,
    ) > amount(s.capacity)
  )
    throw Error("Inventory full after crafting");
  const item = rollEquipment(s, r);
  s.materials = after;
  s.equipment.push(item);
  return item;
}
export function enhancementCost(e: Equipment): {
  gold: bigint;
  stones: bigint;
  chance: number;
} {
  const n = e.enhancement + 1;
  if (n > 20) throw Error("Maximum enhancement");
  return {
    gold: BigInt(
      10 *
        Math.ceil(
          (content.costFactors[recipeById[e.templateId].tier - 1] *
            n *
            (n + 4)) /
            100,
        ),
    ),
    stones: BigInt(1 + Math.floor((n - 1) / 4)),
    chance: 100 - 5 * Math.max(0, n - 4),
  };
}
export function sell(s: GameState, id: string, q: string): void {
  const e = s.equipment.find((e) => e.id === id);
  let value: bigint;
  if (e) {
    if (e.owner) {
      const owner = s.characters.find(c => c.id === e.owner);
      if (!owner) throw Error("Equipment owner missing");
      delete owner.gear[recipeById[e.templateId].slot as keyof typeof owner.gear];
    }
    value = BigInt(
      content.salePrices[recipeById[e.templateId].tier - 1][e.rarity],
    );
    s.equipment = s.equipment.filter((x) => x !== e);
  } else {
    if (!/^\d+$/.test(q) || amount(q) <= 0n) throw Error("Invalid quantity");
    const m = materialById[id];
    if (!m || id === "mat_nameless_seal") throw Error("Not sellable");
    add(s.materials, id, -amount(q));
    value = amount(q) * BigInt(m.sale);
  }
  s.gold = (amount(s.gold) + value).toString();
}
