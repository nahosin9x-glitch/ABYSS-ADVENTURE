import { writeFileSync, mkdirSync } from "node:fs";
import { newGame } from "../core/game";
import { createCharacter } from "../characters";
import { content, recipes } from "../content";
import { startBattle, beginIdle, stepIdle } from "../world";
import { stepBattle } from "../combat";
const results: object[] = [];
// Use actual catalogue names rather than assuming class branch labels.
const final = (base: string, index: number) =>
  content.classPaths.filter((p) => p[0] === base)[index]?.[4] ?? base;
const party = [
  final("Warrior", 0),
  final("Mage", 0),
  final("Mage", 2),
  final("Rogue", 0),
];
for (const level of [60, 65, 70, 75])
  for (const enhancement of [0, 10, 20]) {
    let wins = 0,
      minBossHP = Infinity;
    for (let seed = 1; seed <= 50; seed++) {
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
      for (let slot = 0; slot < 4; slot++) {
        const path = content.classPaths.find((p) => p[4] === party[slot])!,
          base = path[0] as "Warrior" | "Mage" | "Rogue";
        const c = createCharacter(s, base);
        c.traits = [];
        c.level = level;
        c.className = path[level === 75 ? 4 : 3];
        c.party = slot;
        s.characters.push(c);
        for (const kind of [
          "Weapon",
          "Hands",
          "Feet",
          "Head",
          "Ring",
          "Necklace",
        ]) {
          const r = recipes.find(
            (r) =>
              r.tier === 10 &&
              r.slot === kind &&
              (r.baseClass === base || r.baseClass === "All"),
          )!;
          const e = {
            id: "item_" + s.nextId++,
            templateId: r.id,
            rarity: 4,
            enhancement,
            affixes: {
              HP: content.flatAffixes["10_Epic"][0][0],
              ATK: content.flatAffixes["10_Epic"][1][0],
              MATK: content.flatAffixes["10_Epic"][1][0],
              DEF: content.flatAffixes["10_Epic"][1][0],
            },
            owner: c.id,
          };
          s.equipment.push(e);
          c.gear[kind as keyof typeof c.gear] = e.id;
        }
      }
      startBattle(s, 10, "boss", s.clock.gameUtc);
      let events = 0;
      while (!s.battle!.result && events++ < 20000) stepBattle(s);
      if (s.battle!.result === "win") wins++;
      minBossHP = Math.min(
        minBossHP,
        s.battle!.actors.find((a) => a.side === "enemy")!.hp,
      );
    }
    results.push({ level, enhancement, runs: 50, wins, minBossHP });
  }
const idle = newGame(42n, {
  gameUtc: 1780000000000,
  elapsed: 0,
  boot: "sim",
  warning: false,
});
startBattle(idle, 1, "normal", idle.clock.gameUtc);
const from = idle.clock.gameUtc;
idle.clock.gameUtc += 14400000;
beginIdle(idle, from, 14400000);
const start = performance.now();
while (!stepIdle(idle, 1000)) {}
const report = {
  content: "R67",
  party,
  note: "Synthetic diagnostic, not an exhaustive balance proof. Epic flat affixes at minimum; no traits. Keep approved balance unchanged.",
  boss10: results,
  idle4h: {
    engineMs: Math.round(performance.now() - start),
    wins: idle.maps[0].wins,
    gold: idle.gold,
    level: idle.characters[0].level,
  },
  apkTested: false,
};
mkdirSync("reports", { recursive: true });
writeFileSync(
  "reports/simulation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
