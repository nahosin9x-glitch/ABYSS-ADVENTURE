import test from "node:test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { newGame, execute, rosterSlotCost } from "../packages/core/game";
import { rng, next } from "../packages/core/random";
import { content, enemies, recipes, materialById } from "../packages/content";
import {
  rollEquipment,
  used,
  receive,
  craft,
  enhancementCost,
  bagCost,
} from "../packages/economy";
import {
  equipmentStats,
  characterStats,
  compareEquipment,
  awardExp,
  ensureCharacterIdentities,
  choices,
  classLevelLabel,
} from "../packages/characters";
import {
  startBattle,
  advanceTo,
  beginIdle,
  stepIdle,
  settle,
} from "../packages/world";
import { stepBattle, enemyActor } from "../packages/combat";
import {
  validate,
  encode,
  decode,
  advanceClock,
  Persistence,
} from "../packages/platform";
import "fake-indexeddb/auto";
const game = () =>
  newGame(42n, {
    gameUtc: 1780000000000,
    elapsed: 0,
    boot: "test",
    warning: false,
  });
test("PCG32 matches published seed/sequence vector", () => {
  const r = rng(42n, 54n);
  assert.deepEqual(
    Array.from({ length: 6 }, () => next(r).toString(16)),
    ["a15c02b7", "7b47f409", "ba1d3330", "83d2f293", "bfa4784b", "cbed606e"],
  );
});
test("R67 catalogue is complete and recipes resolve", () => {
  assert.equal(enemies.length, 78);
  assert.equal(recipes.length, 174);
  assert.equal(content.daily.length, 30);
  assert.equal(new Set(content.classPaths.flat()).size, 45);
  assert.equal(
    content.exp.reduce((a, b) => a + b, 0),
    5622400,
  );
  for (const r of recipes)
    for (const m of r.ingredients) assert.ok(materialById[m.id], m.id);
});
test("all recipes craft atomically with exact ingredients", () => {
  for (const r of recipes) {
    const s = game();
    s.unlockedMap = 10;
    for (const m of r.ingredients) s.materials[m.id] = String(m.quantity);
    craft(s, r.id);
    assert.equal(s.equipment.length, 1);
    assert.deepEqual(s.materials, {});
    validate(s);
  }
});
test("failed command changes neither money nor RNG", () => {
  const s = game(),
    before = JSON.stringify(s);
  assert.throws(() =>
    execute(s, { type: "craft", id: recipes[0].id }, "failed"),
  );
  assert.equal(JSON.stringify(s), before);
});
test("transaction replay remains idempotent beyond 256 receipts", () => {
  let s = game();
  s.gold = "999999999999";
  s = execute(s, { type: "bag-slot" }, "first");
  for (let i = 0; i < 300; i++)
    s = execute(s, { type: "settings", music: 0, sfx: 0 }, "setting" + i);
  const before = JSON.stringify(s);
  s = execute(s, { type: "bag-slot" }, "first");
  assert.equal(JSON.stringify(s), before);
});
test("stale revision rejected", () =>
  assert.throws(() => execute(game(), { type: "bag-slot" }, "stale", 9)));
test("3000 equipment rolls obey unique affix/counter/dot caps", () => {
  const s = game();
  for (let i = 0; i < 3000; i++) {
    const e = rollEquipment(s, recipes[i % recipes.length]),
      keys = Object.keys(e.affixes);
    assert.ok(keys.length >= 1 && keys.length <= 7);
    assert.ok(
      keys.filter(
        (k) =>
          ![
            "HP",
            "ATK",
            "MATK",
            "DEF",
            "CRIT",
            "PoisonDamage",
            "DOTDamage",
          ].includes(k),
      ).length <= 2,
    );
    assert.ok(
      keys.filter((k) => ["PoisonDamage", "DOTDamage"].includes(k)).length <= 1,
    );
    assert.ok(Object.values(e.affixes).every(Number.isFinite));
  }
});
test("equipment comparison uses the same totals as combat", () => {
  const s = game(),
    c = s.characters[0],
    e = rollEquipment(
      s,
      recipes.find((r) => r.baseClass === "Warrior" && r.slot === "Weapon")!,
    );
  e.enhancement = 20;
  s.equipment.push(e);
  const before = characterStats(s, c),
    delta = compareEquipment(s, c, e);
  const after = execute(
    s,
    { type: "equip", id: e.id, character: c.id },
    "equip",
  );
  for (const k of Object.keys(before) as (keyof typeof before)[])
    assert.equal(
      characterStats(after, after.characters[0])[k] - before[k],
      delta[k],
    );
  assert.ok(equipmentStats(e).ATK > 0);
  assert.throws(() => enhancementCost(e));
});
test("full inventory preserves pending rewards", () => {
  const s = game();
  for (let i = 0; i < 100; i++) s.equipment.push(rollEquipment(s, recipes[0]));
  const id = content.materials[0].id;
  receive(s, id, 8n);
  assert.equal(used(s), 100n);
  assert.equal(s.pending[id], "8");
  assert.equal(s.materials[id], undefined);
});
test("EXP pauses at each evolution gate and resumes after advancement", () => {
  const c = game().characters[0];
  for (const gate of [10, 25, 50, 75]) {
    awardExp(c, 100000000);
    assert.equal(c.classLevel, gate);
    assert.equal(c.exp, 0);
    assert.ok(choices(c).length);
    awardExp(c, 100000000);
    assert.equal(c.classLevel, gate);
    c.className = choices(c)[0];
    c.classLevel = 1; c.classExp = 0;
    c.exp = 0;
  }
  awardExp(c, 100000000);
  assert.equal(c.level, 75);
  assert.equal(c.exp, 0);
});
test("clock ignores wall jumps and reboots", () => {
  const a = game().clock;
  assert.equal(
    advanceClock(a, { elapsed: 1000, boot: "test", wall: 0 }).gameUtc,
    a.gameUtc + 1000,
  );
  assert.equal(
    advanceClock(a, { elapsed: 999999, boot: "different", wall: 9e12 }).gameUtc,
    a.gameUtc,
  );
});
test("offline crash recovery resumes exactly the persisted job", async () => {
  const base = game();
  startBattle(base, 1, "normal", base.clock.gameUtc);
  const previous = base.clock.gameUtc;
  base.clock.gameUtc += 14401000;
  beginIdle(base, previous, 14401000);
  const uninterrupted = structuredClone(base);
  while (!stepIdle(uninterrupted, 1000)) {}
  stepIdle(base, 7);
  const restored = await decode(await encode(base));
  while (!stepIdle(restored, 13)) {}
  assert.deepEqual(restored, uninterrupted);
  validate(restored);
});
test("offline job blocks interactive transactions", () => {
  const s = game();
  startBattle(s, 1, "normal", s.clock.gameUtc);
  beginIdle(s, s.clock.gameUtc, 2000);
  assert.throws(() => execute(s, { type: "leave" }, "leave"));
});
test("battle result pays only once", () => {
  const s = game();
  startBattle(s, 1, "normal", s.clock.gameUtc);
  s.battle!.result = "win";
  settle(s, s.clock.gameUtc + 1000);
  const before = JSON.stringify(s);
  settle(s, s.clock.gameUtc + 1000);
  assert.equal(JSON.stringify(s), before);
});
test("final damage remains visible before settlement and completed log preserves drops", () => {
  const s = game();
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const b = s.battle!;
  const player = b.actors.find(a => a.side === "player")!;
  const enemy = b.actors.find(a => a.side === "enemy")!;
  b.actors = [player, enemy];
  enemy.hp = 1;
  enemy.stats.EVA = 0;
  player.stats.ATK = 10000;
  advanceTo(s, s.clock.gameUtc + 100000, false, 100);
  assert.equal(s.battle?.result, "win");
  assert.ok(s.battle?.visualEvents?.some(e => e.target === enemy.id && e.value < 0));
  const until = s.battle!.presentationUntil!;
  advanceTo(s, until - 1);
  assert.ok(s.battle, "the final hit must remain available for rendering");
  advanceTo(s, until);
  assert.equal(s.battle, null);
  assert.equal(s.completedBattle?.id, b.id);
  assert.ok(s.completedBattle?.log.some(l => l.startsWith("Drop ·")));
  assert.ok(s.completedBattle?.log.some(l => l.startsWith("Victory ·")));
});
test("killing critical hit counts for daily progression", () => {
  const s = game();
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const b = s.battle!,
    a = b.actors[0];
  a.abilities.cycle = 1;
  a.abilities.cycleType = "crit";
  a.abilities.cycleValue = 1.5;
  a.stats.ATK = 1e8;
  a.stats.ACC = 1e8;
  b.actors = b.actors.slice(0, 2);
  b.actors[1].stats.EVA = 0;
  for (let i = 0; i < 10 && !b.result; i++) stepBattle(s);
  assert.equal(b.result, "win");
  assert.equal(b.critActions, 1);
});
test("normal simulation deterministic across event budgets", () => {
  const a = game();
  startBattle(a, 1, "normal", a.clock.gameUtc);
  const b = structuredClone(a),
    target = a.clock.gameUtc + 3600000;
  while (!advanceTo(a, target, false, 1000)) {}
  while (!advanceTo(b, target, false, 7)) {}
  assert.deepEqual(a, b);
  validate(a);
});
test("checksum tampering rejected", async () => {
  const text = await encode(game()),
    obj = JSON.parse(text);
  obj.state.gold = "999999";
  await assert.rejects(decode(JSON.stringify(obj)), /checksum/);
});
test("invalid inventory references rejected", () => {
  const s = game();
  s.characters[0].gear.Weapon = "missing";
  assert.throws(() => validate(s));
});
test("concurrent database writers cannot overwrite a newer save", async () => {
  const p = new Persistence();
  await p.load();
  const s = game();
  await p.commit(s, true);
  const other = new Persistence();
  await other.load();
  s.revision++;
  await p.commit(s);
  await assert.rejects(other.commit(s), /conflict/);
  const check = await p.load();
  assert.equal(check.state!.revision, s.revision);
});

test("summon while farming consumes a ticket and names the reserve uniquely", () => {
  const s = game();
  s.rosterCapacity = 3;
  s.tickets = "2";
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const first = execute(s, { type: "summon" }, "farm-summon-1");
  assert.equal(first.tickets, "1");
  assert.equal(first.characters.length, 2);
  assert.equal(first.characters[1].party, null);
  assert.ok(first.farming);
  const second = execute(first, { type: "summon" }, "farm-summon-2");
  assert.equal(second.tickets, "0");
  assert.equal(new Set(second.characters.map(c => c.name)).size, 3);
  for (const c of second.characters) {
    assert.equal(c.gender, c.baseClass === "Mage" ? "female" : "male");
    assert.ok(c.name);
  }
  validate(second);
});
test("older saves receive distinct names without changing character identities", () => {
  const s = game();
  s.rosterCapacity = 2;
  s.characters.push({ ...structuredClone(s.characters[0]), id: "char_legacy", name: undefined });
  s.characters[0].name = undefined;
  s.characters[1].party = null;
  ensureCharacterIdentities(s);
  assert.equal(new Set(s.characters.map(c => c.name)).size, 2);
  validate(s);
});

test("craft and sell remain available while an expedition runs", () => {
  const s = game();
  s.rosterCapacity = 2;
  const r = recipes[0];
  for (const ing of r.ingredients) s.materials[ing.id] = String(ing.quantity + 5);
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const crafted = execute(s, { type: "craft", id: r.id }, "farm-craft");
  assert.equal(crafted.equipment.length, 1);
  assert.ok(crafted.farming);
  const mat = r.ingredients[0].id;
  const sold = execute(crafted, { type: "sell", id: mat, quantity: "1" }, "farm-sell");
  assert.equal(BigInt(sold.materials[mat]), BigInt(crafted.materials[mat]) - 1n);
  assert.ok(sold.farming);
});
test("switching unlocked maps requires a distinct reserve party", () => {
  const s = game();
  s.rosterCapacity = 2;
  s.unlockedMap = 2;
  s.characters.push({ ...structuredClone(s.characters[0]), id: "char_reserve", name: "Roderic", gear: {}, party: null });
  startBattle(s, 1, "normal", s.clock.gameUtc);
  assert.throws(() => execute(s, { type: "start", map: 2, kind: "normal", partyIds: [s.characters[0].id] }, "wrong-map"), /unavailable/);
  const next = execute(s, { type: "start", map: 2, kind: "normal", partyIds: ["char_reserve"] }, "new-map");
  assert.equal(next.battle?.map, 2);
  assert.equal(next.characters[0].party, null);
  assert.equal(next.characters[1].party, 0);
});
test("equipment can be enhanced, equipped and sold while farming", () => {
  const s = game();
  s.unlockedMap = 2;
  s.gold = "1000";
  s.materials.mat_enhancement_stone = "10";
  const recipe = recipes.find(r => r.baseClass === "Warrior" && r.slot === "Weapon")!;
  const item = rollEquipment(s, recipe);
  s.equipment.push(item);
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const enhanced = execute(s, { type: "enhance", id: item.id }, "enhance-farming");
  assert.equal(enhanced.equipment[0].enhancement, 1);
  assert.equal(enhanced.materials.mat_enhancement_stone, "9");
  const equipped = execute(enhanced, { type: "equip", id: item.id, character: s.characters[0].id }, "equip-farming");
  assert.equal(equipped.equipment[0].owner, s.characters[0].id);
  const unequipped = execute(equipped, { type: "unequip", id: item.id }, "unequip-farming");
  assert.equal(unequipped.equipment[0].owner, null);
  const sold = execute(unequipped, { type: "sell", id: item.id, quantity: "1" }, "sell-farming");
  assert.equal(sold.equipment.length, 0);
  assert.ok(sold.farming);
});
test("enhancement uses Gold and stones even before Map 2", () => {
  const s = game();
  s.gold = "1000";
  s.materials.mat_enhancement_stone = "2";
  const item = rollEquipment(s, recipes[0]);
  s.equipment.push(item);
  const next = execute(s, {type:"enhance",id:item.id}, "enhance-map-one");
  assert.equal(next.equipment[0].enhancement, 1);
  assert.equal(next.materials.mat_enhancement_stone, "1");
});
test("selling worn equipment during farming clears the slot atomically", () => {
  const s = game();
  const r = recipes.find(x => x.baseClass === "Warrior" && x.slot === "Weapon")!;
  const e = rollEquipment(s, r);
  e.owner = s.characters[0].id;
  s.equipment.push(e);
  s.characters[0].gear.Weapon = e.id;
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const next = execute(s, { type:"sell", id:e.id, quantity:"1" }, "sell-worn");
  assert.equal(next.equipment.length, 0);
  assert.equal(next.characters[0].gear.Weapon, undefined);
  assert.ok(next.farming);
  validate(next);
});
test("roster slots can be bought during a running expedition when Gold suffices", () => {
  const s = game();
  s.gold = "1000";
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const next = execute(s, { type:"roster-slot" }, "open-roster-farming");
  assert.equal(next.rosterCapacity, 2);
  assert.ok(next.farming);
});

test("evolution options have approved class art and advance at level ten", () => {
  const s = game();
  const c = s.characters[0];
  c.level = 17; c.classLevel = 10;
  c.exp = 0;
  const options = choices(c);
  assert.equal(options.length, 2);
  for (const name of options) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    assert.ok(existsSync(`public/art/classes/${slug}.png`));
  }
  const next = execute(s, {type:"advance",id:c.id,className:options[0]}, "evolve-choice");
  assert.equal(next.characters[0].className, options[0]);
  assert.equal(classLevelLabel(next.characters[0]), "Lv 1/25");
  awardExp(next.characters[0], content.exp[16]);
  assert.equal(classLevelLabel(next.characters[0]), "Lv 2/25");
});
test("roster prices are reduced by thirty percent and rounded to hundreds", () => {
  assert.equal(rosterSlotCost(3), 3300n);
  assert.equal(rosterSlotCost(2), 800n);
  const s = game();
  s.gold = "10000";
  const next = execute(s, {type:"roster-slot"}, "reduced-roster-price");
  assert.equal(next.gold, "9900");
});
test("enemy and boss actors gain 25 percent of every listed stat", () => {
  for (const e of [enemies.find(x => x.kind === "normal")!, enemies.find(x => x.kind === "boss")!]) {
    const a = enemyActor(e.id, 0);
    for (const [key, value] of Object.entries(e.stats))
      assert.equal(a.stats[key as keyof typeof a.stats], Math.ceil(Math.ceil(value * 1.25) * 1.25));
    assert.equal(a.hp, a.stats.HP);
  }
});
test("one bag purchase adds five slots and advances its price once", () => {
  const s = game();
  s.gold = "10000";
  assert.equal(bagCost(s), 500n);
  const next = execute(s, {type:"bag-slot"}, "bag-five");
  assert.equal(next.capacity, "105");
  assert.equal(bagCost(next), 2000n);
  validate(next);
});
test("settlement grants seventy percent of base combat EXP", () => {
  const s = game();
  startBattle(s, 1, "normal", s.clock.gameUtc);
  const foes = s.battle!.actors.filter(a => a.kind === "enemy");
  const base = foes.reduce((sum,a) => sum + enemies.find(e => e.id === a.templateId)!.exp, 0);
  s.battle!.result = "win";
  settle(s, s.clock.gameUtc);
  const reward = s.rewards.at(-1)!;
  const gained = Number(reward.match(/(\d+) EXP/)![1]);
  assert.ok(gained >= Math.floor(Math.floor(base * .9 * .7) * 1.15) - foes.length);
  assert.ok(gained <= Math.floor(Math.floor(base * 1.1 * .7) * 1.15) + foes.length);
  assert.ok(s.characters[0].level < 10);
});

test("every equipment base and affix tier is valid; upgrades use integers without changing affixes", () => {
  const s = game();
  for (const r of recipes) {
    assert.ok(Object.keys(r.stats).length > 0, r.name);
    for (const [key, value] of Object.entries(r.stats)) {
      assert.ok(["HP","ATK","MATK","DEF","ACC","CRIT","EVA"].includes(key), `${r.name}: ${key}`);
      assert.ok(Number.isInteger(value) && value >= 0);
    }
    const e = rollEquipment(s,r);
    for (const value of Object.values(e.affixes)) assert.ok(Number.isFinite(value) && value > 0);
    for (let n = 1; n <= 20; n++) {
      const previous = equipmentStats({...e,enhancement:n-1});
      const upgraded = equipmentStats({...e,enhancement:n});
      for (const [key,value] of Object.entries(previous)) if (key !== "ACC" && value > 0) assert.ok(Number.isInteger(upgraded[key]) && upgraded[key] >= value, `${r.name} +${n}`);
    }
  }
  for (let tier=1;tier<=10;tier++) for (const rarity of content.rarities) {
    const ranges=content.flatAffixes[`${tier}_${rarity}` as keyof typeof content.flatAffixes];
    if (!ranges) { assert.equal(content.rarityWeights[tier-1][content.rarities.indexOf(rarity)],0); continue; }
    assert.equal(ranges.length,3);
    for (const [min,max] of ranges) assert.ok(Number.isInteger(min) && Number.isInteger(max) && min>0 && max>=min);
  }
  const r = recipes.find(r => r.name === "Ashfall Bronze Sword")!;
  const e = rollEquipment(s,r);
  assert.equal(equipmentStats({...e,enhancement:1}).ATK, 10);
  assert.equal(equipmentStats({...e,enhancement:2}).ATK, 10);
  assert.equal(equipmentStats({...e,enhancement:3}).ATK, 10);
  const c = s.characters.find(c => c.baseClass === "Warrior") ?? s.characters[0];
  e.owner=c.id; c.gear.Weapon=e.id; s.equipment.push(e);
  e.enhancement=0; const before=characterStats(s,c).ATK;
  e.enhancement=1; assert.ok(characterStats(s,c).ATK > before);
});

test("Daily milestones require completion, award exact resources once, and reset tomorrow", () => {
  let s = game();
  assert.ok(s.daily.tasks.every(t => [5,10,20].includes(t.target!)));
  assert.throws(() => execute(s,{type:"claim-daily",milestone:1},"locked"));
  for (const t of s.daily.tasks) { t.progress=t.target!; t.done=true; }
  const gold=BigInt(s.gold), stones=BigInt(s.materials.mat_enhancement_stone ?? "0"), tickets=BigInt(s.tickets);
  s=execute(s,{type:"claim-daily",milestone:1},"gold");
  assert.equal(BigInt(s.gold),gold+500n);
  assert.equal(execute(s,{type:"claim-daily",milestone:1},"gold"),s);
  assert.throws(() => execute(s,{type:"claim-daily",milestone:1},"duplicate"));
  s=execute(s,{type:"claim-daily",milestone:3},"stones");
  s=execute(s,{type:"claim-daily",milestone:5},"ticket");
  assert.equal(BigInt(s.materials.mat_enhancement_stone),stones+5n);
  assert.equal(BigInt(s.tickets),tickets+1n);
  validate(s);
  s.clock.gameUtc += 86400000;
  s=execute(s,{type:"settings",music:0,sfx:0},"tomorrow");
  assert.deepEqual(s.daily.claimedMilestones,[]);
  assert.equal(s.daily.tasks.filter(t=>t.done).length,0);
});

test("v18 Daily saves migrate targets without discarding progress or duplicating ticket", () => {
  const s=game(); delete s.daily.ruleVersion; delete s.daily.claimedMilestones;
  s.daily.ticketGranted=true;
  for (const t of s.daily.tasks) { delete t.target; const d=content.daily.find(d=>d.id===t.id)!;t.progress=d.legacyTarget;t.done=true; }
  validate(s);
  const next=execute(s,{type:"settings",music:0,sfx:0},"migrate");
  validate(next);
  assert.ok(next.daily.tasks.every(t=>[5,10,20].includes(t.target!) && t.progress===t.target));
  assert.deepEqual(next.daily.claimedMilestones,[5]);
  assert.equal(next.gold,s.gold); assert.equal(next.tickets,s.tickets);
});

test("material rewards may be empty and gold respects the new 35 percent multiplier", () => {
  let empty=0;
  for (let i=0;i<100;i++) {
    const s=game(); for(let n=0;n<i;n++) next(s.rng.loot);
    startBattle(s,1,"normal",s.clock.gameUtc);
    const b=s.battle!;
    const foes=b.actors.filter(a=>a.kind==="enemy");
    b.kills=foes.map(a=>a.id);b.result="win";
    const min=Math.round(foes.reduce((n,a)=>n+Math.ceil(enemies.find(e=>e.id===a.templateId)!.gold*.9),0)*1.35);
    const max=Math.round(foes.reduce((n,a)=>n+Math.floor(enemies.find(e=>e.id===a.templateId)!.gold*1.1),0)*1.35);
    const gold=BigInt(s.gold);settle(s,s.clock.gameUtc);
    const earned=Number(BigInt(s.gold)-gold);assert.ok(earned>=min && earned<=max);
    if (b.log.includes("Drop · No materials this battle.")) empty++;
  }
  assert.ok(empty>0 && empty<100);
  assert.equal(content.rewardBalance.materialDropMultiplier,.8);
  assert.equal(content.rewardBalance.enhancementStoneDropMultiplier,.5);
});

test("normal victories roll one 7 percent Summon Ticket chance per battle and replay cannot repay", () => {
  let drops=0;
  for (let i=0;i<500;i++) {
    const s=game();for(let n=0;n<i;n++)next(s.rng.loot);
    startBattle(s,1,"normal",s.clock.gameUtc);
    s.battle!.result="win";
    const tickets=BigInt(s.tickets);settle(s,s.clock.gameUtc);
    const gained=BigInt(s.tickets)-tickets;
    assert.ok(gained===0n || gained===1n);
    drops+=Number(gained);
    settle(s,s.clock.gameUtc);assert.equal(BigInt(s.tickets),tickets+gained);
  }
  assert.equal(content.rewardBalance.normalSummonTicketChance,.07);
  assert.ok(drops>=15 && drops<=60, `Observed ${drops}/500`);
});
test("Summon without tickets reports the condition without changing state", () => {
  const s=game();s.tickets="0";
  const before=JSON.stringify(s);
  assert.throws(()=>execute(s,{type:"summon"},"no-ticket"),/Not enough Summon Tickets/);
  assert.equal(JSON.stringify(s),before);
});

test("Fighter 16/25 continues EXP to 25/25; final class alone reaches 75/75", () => {
  let s=game();const c=s.characters[0];
  c.baseClass="Warrior";c.className="Fighter";c.level=25;c.classLevel=16;c.exp=0;c.classExp=0;
  assert.deepEqual(choices(c),[]);
  awardExp(c,content.exp[24]);
  assert.equal(classLevelLabel(c),"Lv 17/25");
  awardExp(c,100000000);
  assert.equal(classLevelLabel(c),"Lv 25/25");assert.ok(choices(c).length);
  validate(s);
  while (choices(s.characters[0]).length) {
    s=execute(s,{type:"advance",id:c.id,className:choices(s.characters[0])[0]},"next-"+s.characters[0].className);
    assert.equal(s.characters[0].classLevel,1);
    awardExp(s.characters[0],100000000);
    validate(s);
  }
  assert.equal(classLevelLabel(s.characters[0]),"Lv 75/75");
  assert.equal(s.characters[0].classExp,0);
});

test('Journal reveals encountered monsters only after a battle finishes, including a loss', () => {
  const s = game();
  startBattle(s,1,'normal',s.clock.gameUtc);
  const ids=s.battle!.actors.filter(a=>a.kind==='enemy').map(a=>a.templateId);
  assert.equal(s.maps[0].seen.length,0);
  s.battle!.result='loss';
  settle(s,s.clock.gameUtc+1000);
  for(const id of ids) assert.ok(s.maps[0].seen.includes(id));
});


test("independent parties run in two maps, survive save/load, and cannot share characters", async () => {
  let s = game();
  const second = structuredClone(s.characters[0]);
  second.id = "reserve_test"; second.name = "Reserve Test"; second.party = null;
  s.characters.push(second); s.rosterCapacity = 2; s.unlockedMap = 2;
  const firstId = s.characters[0].id;
  s = execute(s,{type:"start",map:1,kind:"normal",partyIds:[firstId]},"map-one");
  const oldBattle = s.battle!.id;
  s = execute(s,{type:"start",map:2,kind:"normal",partyIds:[second.id]},"map-two");
  assert.equal(s.battle!.map,2);
  assert.equal(s.expeditions![0].battle!.id,oldBattle);
  assert.deepEqual(s.battle!.actors.filter(a=>a.kind==="character").map(a=>a.id),[second.id]);
  assert.throws(()=>execute(s,{type:"start",map:1,kind:"normal",partyIds:[second.id]},"duplicate-map"),/already in combat/);
  s.unlockedMap=3;
  assert.throws(()=>execute(s,{type:"start",map:3,kind:"normal",partyIds:[firstId]},"duplicate-hero"),/unavailable/);
  validate(s);
  const restored = await decode(await encode(s));
  assert.equal(restored.expeditions![0].battle!.id,oldBattle);
  const target=s.clock.gameUtc+2500;
  advanceTo(s,target,false,100);
  assert.ok(s.expeditions![0].battle!.openingDone);
  s=execute(s,{type:"resume",map:1},"return-one");
  assert.equal(s.battle!.map,1);
  assert.equal(s.expeditions![0].map,2);
  assert.equal(s.characters.find(c=>c.id===firstId)!.party,0);
  s=execute(s,{type:"leave"},"leave-one");
  assert.equal(s.battle,null);
  assert.equal(s.expeditions![0].map,2);
  validate(s);
});
