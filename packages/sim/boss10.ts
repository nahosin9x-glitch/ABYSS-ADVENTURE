import { mkdirSync, writeFileSync } from "node:fs";
import { newGame } from "../core/game";
import { createCharacter, characterStats } from "../characters";
import { content, recipes } from "../content";
import { startBattle } from "../world";
import { stepBattle } from "../combat";
import { validate } from "../platform";
import type { Equipment, BaseClass, GameState } from "../core/types";
const parties = [
  ["Destroyer", "Chaos Weaver", "Soul Saint", "Spectral Dancer"],
  ["Aegis", "Devil Lich", "Soul Saint", "Soul Sniper"],
  ["Valkyrie", "Soul Sniper", "Soul Sniper", "Soul Saint"],
  ["Destroyer", "Destroyer", "Destroyer", "Destroyer"],
  ["Soul Sniper", "Soul Sniper", "Soul Sniper", "Soul Sniper"],
  ["Devil Lich", "Devil Lich", "Devil Lich", "Soul Saint"],
  ["Void Reaper", "Tempest Gale", "Soul Sniper", "Soul Saint"],
  ["Soul Sniper", "Soul Sniper", "Soul Sniper", "Soul Saint"],
];
const profiles = [
  {
    name: "Epic +20 optimized flat affixes",
    rarity: 4,
    enhancement: 20,
    traits: false,
  },
  {
    name: "Supreme +20 maximal legal affixes + traits",
    rarity: 7,
    enhancement: 20,
    traits: true,
  },
];
function setup(
  seed: number,
  party: string[],
  profile: (typeof profiles)[number],
): GameState {
  const s = newGame(BigInt(seed), {
    gameUtc: 1780000000000,
    elapsed: 0,
    boot: "sim",
    warning: false,
  });
  s.characters = [];
  s.rosterCapacity = 4;
  s.unlockedMap = 10;
  s.maps[9].bossUnlocked = true;
  for (const [slot, name] of party.entries()) {
    const path = content.classPaths.find((p) => p[4] === name)!,
      base = path[0] as BaseClass,
      c = createCharacter(s, base);
    c.className = name;
    c.level = 75;
    c.party = slot;
    c.traits = profile.traits
      ? ["Primordial", base === "Mage" ? "Arcane Power" : "Might"]
      : [];
    s.characters.push(c);
    for (const kind of [
      "Weapon",
      "Hands",
      "Feet",
      "Head",
      "Ring",
      "Necklace",
    ]) {
      const choices = recipes.filter(
        (r) =>
          r.tier === 10 &&
          r.slot === kind &&
          (r.baseClass === "All" || r.baseClass === base),
      );
      const r = choices.find((r) =>
        kind === "Ring"
          ? base === "Mage"
            ? r.name === "Silencebound Signet"
            : r.name === "Siegebreaker Signet"
          : kind === "Weapon" && base === "Rogue"
            ? r.ranged
            : kind === "Necklace"
              ? r.name === "Abyssward Pendant"
              : true,
      )!;
      const range =
        content.flatAffixes[
          ("10_" +
            content.rarities[
              profile.rarity
            ]) as keyof typeof content.flatAffixes
        ];
      const affixes: Record<string, number> = {
        HP: range[0][1],
        [base === "Mage" ? "MATK" : "ATK"]: range[1][1],
        DEF: range[1][1],
        CRIT: range[2][1],
      };
      if (profile.rarity === 7) {
        affixes[base === "Mage" ? "ATK" : "MATK"] = range[1][1];
        const counters = content.counterRanges.Supreme;
        if (kind === "Weapon" || kind === "Ring") {
          affixes.ShieldBreak = counters[1][1] / 100;
          affixes.DefenseBreak = counters[1][1] / 100;
        } else {
          affixes.PhysicalDR = counters[0][1] / 100;
          affixes.ElementalDR = counters[0][1] / 100;
        }
      }
      const e: Equipment = {
        id: "item_" + s.nextId++,
        templateId: r.id,
        rarity: profile.rarity,
        enhancement: profile.enhancement,
        affixes,
        owner: c.id,
      };
      s.equipment.push(e);
      c.gear[kind as keyof typeof c.gear] = e.id;
    }
  }
  validate(s);
  return s;
}
const cases: object[] = [],
  examples: object[] = [];
for (const profile of profiles)
  for (const party of parties) {
    let wins = 0,
      enrage = 0,
      deaths = 0,
      minHP = Infinity,
      maxHP = 0,
      rounds = 0,
      hpDamage = 0,
      shieldNetLoss = 0,
      aliveBeforeEnrage = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const s = setup(seed, party, profile);
      if (seed === 1)
        examples.push({
          profile: profile.name,
          party,
          characters: s.characters.map((c) => ({
            ...c,
            stats: characterStats(s, c),
          })),
          equipment: s.equipment,
        });
      startBattle(s, 10, "boss", s.clock.gameUtc);
      const b = s.battle!,
        boss = b.actors.find((a) => a.side === "enemy")!;
      let events = 0;
      while (!b.result && events++ < 20000) {
        const hp = boss.hp,
          sh = boss.shield,
          willEnrage =
            b.phase === "turn" && b.turn >= b.queue.length && b.round === 30,
          alive = b.actors.filter(
            (a) => a.kind === "character" && a.hp > 0,
          ).length;
        stepBattle(s);
        hpDamage += Math.max(0, hp - boss.hp);
        shieldNetLoss += Math.max(0, sh - boss.shield);
        if (willEnrage && b.result === "loss") {
          enrage++;
          aliveBeforeEnrage += alive;
        }
      }
      if (!b.result) throw Error("Simulation event budget exhausted");
      if (b.result === "win") wins++;
      else if (b.round < 30 || !b.log.at(-1)?.includes("Enrage")) deaths++;
      minHP = Math.min(minHP, boss.hp);
      maxHP = Math.max(maxHP, boss.hp);
      rounds += b.round;
    }
    cases.push({
      profile: profile.name,
      party,
      runs: 50,
      wins,
      enrage,
      combatDeaths: deaths,
      meanRound: rounds / 50,
      minBossHP: minHP,
      maxBossHP: maxHP,
      meanBossHPDamage: Math.round(hpDamage / 50),
      meanBossShieldNetDecrease: Math.round(shieldNetLoss / 50),
      meanAliveBeforeEnrage: enrage ? aliveBeforeEnrage / enrage : null,
    });
  }
mkdirSync("reports", { recursive: true });
const report = {
  content: "R67",
  build: "r67-combat-review-2",
  seeds: "1..50 per case",
  totalRuns: cases.length * 50,
  limits: [
    "These are constructed diagnostic loadouts, not observed player acquisition outcomes.",
    "Supreme profile intentionally uses maximal legal rolls and rare traits; it does not represent normal progression.",
    "Shield metric sums net per-event decreases; same-event regeneration can mask absorption.",
    "No balance values were edited. No claim of exhaustive composition coverage.",
  ],
  bossHP: 285000,
  bossDEF: 790,
  openingAndReleaseShield: 14250,
  roundLimit: 30,
  cases,
};
writeFileSync(
  "reports/boss10-review.json",
  JSON.stringify(report, null, 2) + "\n",
);
writeFileSync(
  "reports/boss10-loadouts.json",
  JSON.stringify(examples, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
