import names from "../content/character-names.json";
import { baseStats, content, recipeById } from "../content";
import { classAbilities } from "../content/abilities";
import type {
  Character,
  Equipment,
  GameState,
  Stats,
  Stat,
  BaseClass,
  Actor,
} from "../core/types";
import { chance, integer, pick } from "../core/random";
export function advancement(c: Character): {
  level: number;
  stat: Stat;
  bonus: number;
} {
  const p = content.classPaths.find((p) => p.includes(c.className)),
    i = p?.indexOf(c.className) ?? 0;
  return {
    level: [1, 10, 25, 50, 75][i],
    stat: c.baseClass === "Mage" ? "MATK" : p?.[1] === "Knight" ? "DEF" : "ATK",
    bonus: [0, 0.03, 0.05, 0.08, 0.12][i],
  };
}
export function choices(c: Character): string[] {
  const i =
    content.classPaths
      .find((p) => p.includes(c.className))
      ?.indexOf(c.className) ?? 0;
  return i >= 4 || classLevel(c) < [10, 25, 50, 75][i]
    ? []
    : [
        ...new Set(
          content.classPaths
            .filter((p) => p[i] === c.className)
            .map((p) => p[i + 1]),
        ),
      ];
}
export function equipmentStats(item: Equipment): Record<string, number> {
  const r = recipeById[item.templateId],
    n = item.enhancement;
  const f =
    1 +
    (3 * Math.min(n, 5) +
      4 * Math.max(0, Math.min(n - 5, 5)) +
      5 * Math.max(0, Math.min(n - 10, 5)) +
      8 * Math.max(0, Math.min(n - 15, 5))) /
      100;
  return Object.fromEntries(
    Object.entries(r.stats).map(([k, v]) => [
      k,
      Math.ceil(v * (k === "ACC" ? 1 : f) - 1e-9),
    ]),
  );
}
export function gearStats(
  s: GameState,
  c: Character,
): { flat: Record<string, number>; mods: Record<string, number> } {
  const flat: Record<string, number> = {},
    mods: Record<string, number> = {};
  for (const id of Object.values(c.gear)) {
    const e = s.equipment.find((e) => e.id === id);
    if (!e) continue;
    const r = recipeById[e.templateId];
    for (const [k, v] of Object.entries(equipmentStats(e)))
      flat[k] = (flat[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.affixes)) {
      const dst = ["HP", "ATK", "MATK", "DEF", "CRIT"].includes(k)
        ? flat
        : mods;
      dst[k] = (dst[k] ?? 0) + v;
    }
    const fixes: [string, string, number][] = [
      ["DEF Pierce", "Pierce", 0.1],
      [
        "Shield Break",
        "ShieldBreak",
        Number(r.fixed.match(/(\d+)%/)?.[1] ?? 0) / 100,
      ],
      ["Poison Resistance", "PoisonRes", 0.2],
      ["Bleeding Resistance", "BleedingRes", 0.15],
      ["Trap Resistance", "TrapRes", 0.15],
      ["Elemental DR", "ElementalDR", 0.08],
      ["CC Resistance", "CCRes", 0.08],
      ["Interrupt Power", "InterruptPower", r.tier === 10 ? 0.1 : 0.08],
      ["Opening Spark", "Opening", 10],
    ];
    for (const [match, k, v] of fixes)
      if (r.fixed.includes(match)) mods[k] = (mods[k] ?? 0) + v;
    if (r.fixed.includes("Dark Unit"))
      mods[r.fixed.includes("MATK") ? "UnitMATK" : "UnitHP"] = r.fixed.includes(
        "MATK",
      )
        ? 0.1
        : 0.2;
    if (r.fixed.includes("Wither penalty")) mods.Mercy = 0.1;
    if (r.fixed.includes("Darkness penalty")) mods.Dawn = 0.3;
  }
  return { flat, mods };
}
export function characterStats(s: GameState, c: Character): Stats {
  const b = baseStats(c.baseClass, c.level),
    a = classAbilities(c.className),
    ad = advancement(c),
    { flat } = gearStats(s, c),
    v = { ...b };
  const traits: Record<string, Partial<Stats>> = {
    Vitality: { HP: 0.1 },
    Fortitude: { DEF: 0.1 },
    Might: { ATK: 0.1 },
    "Arcane Power": { MATK: 0.1 },
    Primordial: { HP: 0.07, ATK: 0.07, MATK: 0.07, DEF: 0.07 },
  };
  for (const k of Object.keys(b) as Stat[])
    v[k] = Math.floor(
      b[k] *
        (1 +
          (a.bonus[k] ?? 0) +
          (k === "HP" || k === ad.stat ? ad.bonus : 0) +
          c.traits.reduce((n, t) => n + (traits[t]?.[k] ?? 0), 0)) +
        (flat[k] ?? 0) +
        (k === "CRIT" && c.traits.includes("Killing Intent") ? 10 : 0)
    );
  return v;
}
export function compareEquipment(
  s: GameState,
  c: Character,
  e: Equipment,
): Stats {
  const r = recipeById[e.templateId],
    before = characterStats(s, c),
    after = characterStats(s, { ...c, gear: { ...c.gear, [r.slot]: e.id } });
  return Object.fromEntries(
    Object.keys(before).map((k) => [k, after[k as Stat] - before[k as Stat]]),
  ) as Stats;
}
export function traitPool(base: BaseClass): string[] {
  return [
    "Vitality",
    "Fortitude",
    "Killing Intent",
    "Bloodthirst",
    "Penetration",
    "Resolve",
    "Tenacity",
    base === "Mage" ? "Arcane Power" : "Might",
    ...(base !== "Rogue" ? ["Warding"] : []),
    ...(base === "Mage" ? ["Restoration"] : []),
  ];
}
export function ensureCharacterIdentities(s: GameState): void {
  const used = new Set<string>();
  for (const c of s.characters) {
    c.gender = c.baseClass === "Mage" ? "female" : "male";
    const pool = names[c.gender];
    if (!c.name || used.has(c.name)) {
      c.name = pool.find(n => !used.has(n)) ?? `${pool[0]} ${c.id}`;
    }
    used.add(c.name);
  }
}
export function createCharacter(
  s: GameState,
  base: BaseClass,
  free = false,
): Character {
  const r = s.rng.summon,
    traits: string[] = [];
  if (free) traits.push("Might");
  else {
    const n = integer(r, 1, 100),
      count = n <= 50 ? 0 : n <= 90 ? 1 : 2;
    if (count && chance(r, 0.002)) traits.push("Primordial");
    while (traits.length < count)
      traits.push(
        pick(
          r,
          traitPool(base).filter((t) => !traits.includes(t)),
        ),
      );
  }
  const gender = base === "Mage" ? "female" : "male";
  const used = new Set(s.characters.map(c => c.name));
  const available = names[gender].filter(n => !used.has(n));
  const name = available.length ? pick(r, available) : `${names[gender][0]} ${s.nextId}`;
  return {
    id: "char_" + s.nextId++,
    name,
    gender,
    baseClass: base,
    className: base,
    level: 1,
    exp: 0,
    classLevel: 1,
    classExp: 0,
    traits,
    gear: {},
    party: free ? 0 : null,
  };
}
export function nextEvolutionLevel(c: Character): number | null {
  const path = content.classPaths.find(p => p.includes(c.className));
  const stage = path?.indexOf(c.className) ?? -1;
  return stage < 0 || stage >= 4 ? null : [10, 25, 50, 75][stage];
}
export function classLevel(c: Character): number {
  if (c.classLevel !== undefined) return c.classLevel;
  const path = content.classPaths.find(p => p.includes(c.className));
  const stage = path?.indexOf(c.className) ?? 0;
  return Math.max(1, c.level - [1, 10, 25, 50, 75][stage] + 1);
}
export function classLevelLabel(c: Character): string {
  return `Lv ${classLevel(c)}/${nextEvolutionLevel(c) ?? 75}`;
}
export function awardExp(c: Character, n: number): void {
  if (!Number.isFinite(n) || n <= 0) return;
  const cap = nextEvolutionLevel(c) ?? 75;
  c.classLevel = classLevel(c);
  if (c.classLevel >= cap) { c.exp = 0; c.classExp = 0; return; }
  c.exp = (c.level >= 75 ? c.classExp ?? c.exp : c.exp) + Math.floor(n);
  while (c.classLevel < cap && c.exp >= content.exp[Math.min(c.level,75) - 1]) {
    c.exp -= content.exp[Math.min(c.level,75) - 1];
    c.level = Math.min(75, c.level + 1);
    c.classLevel++;
  }
  if (c.classLevel >= cap) c.exp = 0;
  c.classExp = c.exp;
  if (c.level === 75) c.exp = 0;
}
export function actorFromCharacter(s: GameState, c: Character): Actor {
  const stats = characterStats(s, c),
    { mods } = gearStats(s, c);
  const map: Record<string, [string, number]> = {
    Bloodthirst: ["Lifesteal", 0.1],
    Restoration: ["Restoration", 0.1],
    Warding: ["Warding", 0.1],
    Penetration: ["Penetration", 0.1],
    Resolve: ["CCRes", 0.1],
    Tenacity: ["DOTRes", 0.1],
  };
  for (const t of c.traits)
    if (map[t]) mods[map[t][0]] = (mods[map[t][0]] ?? 0) + map[t][1];
  const weapon = s.equipment.find((e) => e.id === c.gear.Weapon);
  return {
    id: c.id,
    templateId: c.className,
    name: c.name ?? c.className,
    side: "player",
    kind: "character",
    baseClass: c.baseClass,
    position: c.party ?? 0,
    level: c.level,
    stats,
    hp: stats.HP,
    shield: 0,
    mp: 0,
    turns: 0,
    statuses: [],
    immune: {},
    abilities: classAbilities(c.className),
    mods,
    flying: false,
    ranged:
      c.baseClass === "Mage" ||
      !!(weapon && recipeById[weapon.templateId].ranged),
    spawnRound: 0,
    channel: false,
    frenzied: false,
    counterReady: 0,
    critReady: false,
    debt: 0,
  };
}
