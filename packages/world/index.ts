import { content, enemies, enemyById, materialById, slug } from "../content";
import { actorFromCharacter, awardExp } from "../characters";
import { chance, integer, pick, weighted } from "../core/random";
import type { Actor, Battle, BattleKind, GameState } from "../core/types";
import { enemyActor, nextEventTime, stepBattle } from "../combat";
import { amount, add, receive, STONE } from "../economy";
export const bossRewardMaterials = [
          "Alpha Wolf Fang",
          "Undead Sigil",
          "Broodmother Venom Gland",
          "Iron Tomb Sigil",
          "Blackore Heart",
          "Patriarch Sigil",
          "Crimson Sigil",
          "Usurper Sigil",
          "Sovereign Sigil",
          "Regent Sigil",
        ];
export const dayId = (utc: number) =>
  Math.floor((utc + 7 * 3600000) / 86400000);
export const dailyTarget = (target: number) => target <= 5 ? 5 : target <= 10 ? 10 : 20;
export function resetDay(s: GameState, utc: number): void {
  const day = dayId(utc);
  if (s.quota.day !== day) s.quota = { day, wins: Array(10).fill(0) };
  if (s.daily.day === day) {
    if (s.daily.ruleVersion !== 1) {
      for (const task of s.daily.tasks) {
        task.target = dailyTarget(content.daily.find(t => t.id === task.id)!.target);
        task.progress = task.done ? task.target : Math.min(task.progress, task.target);
        task.done = task.progress >= task.target;
      }
      s.daily.claimedMilestones = s.daily.ticketGranted ? [5] : [];
      s.daily.ruleVersion = 1;
    }
    return;
  }
  const available = enemies.filter(
      (e) =>
        e.kind === "normal" &&
        e.map <= s.unlockedMap &&
        !["Cursed Reliquary", "Void Relic Keeper"].includes(e.name),
    ).length,
    templates = content.daily.filter(
      (t) => t.group !== 5 || dailyTarget(t.target) <= available,
    ),
    groups = [...new Set(templates.map(t => t.group))],
    chosen: number[] = [];
  while (chosen.length < 5)
    chosen.push(
      groups.splice(integer(s.rng.daily, 0, groups.length - 1), 1)[0],
    );
  s.daily = {
    day,
    tier: s.unlockedMap,
    tasks: chosen.map((g) => ({
      id: pick(
        s.rng.daily,
        templates.filter((t) => t.group === g),
      ).id,
      progress: 0,
      done: false,
    })),
    species: [],
    ticketGranted: false,
    ruleVersion: 1,
    claimedMilestones: [],
  };
  s.daily.tasks.forEach(t => { t.target = dailyTarget(content.daily.find(d => d.id === t.id)!.target); });
}
export function bossReady(s: GameState, map: number): boolean {
  const p = s.maps[map - 1];
  if (p.bossUnlocked) return true;
  const species = Object.keys(p.kills).length;
  switch (map) {
    case 1:
      return p.seen.length >= 4;
    case 2:
      return p.seen.length >= 5;
    case 3:
      return amount(p.streak) >= 30n;
    case 4:
      return amount(p.wins) >= 30n && species >= 6;
    case 5:
      return amount(p.wins) >= 40n && species >= 6;
    case 6:
      return s.hidden.defeated;
    case 7:
      return amount(p.completed) >= 100n && s.squirrel;
    case 8:
      return s.miniCleared;
    case 9:
      return enemies
        .filter((e) => e.map === 9 && e.kind === "normal")
        .every((e) => amount(p.kills[e.id]) >= 30n);
    case 10:
      return enemies
        .filter((e) => e.map === 10 && e.kind === "normal")
        .every((e) => amount(p.kills[e.id]) >= 50n);
    default:
      return false;
  }
}
export const miniReady = (s: GameState) =>
  !s.miniCleared &&
  amount(s.maps[7].wins) >= 75n &&
  Object.keys(s.maps[7].kills).length >= 8;
export function gateText(s: GameState, map: number): string {
  const p = s.maps[map - 1];
  return [
    "Encounter 4 species (" + p.seen.length + "/4)",
    "Encounter 5 species (" + p.seen.length + "/5)",
    "Win streak " + p.streak + "/30",
    p.wins +
      "/30 wins · " +
      Object.keys(p.kills).length +
      "/6 species. Next map: streak " +
      p.streak +
      "/40",
    p.wins + "/40 wins · " + Object.keys(p.kills).length + "/6 species",
    "Defeat The Unnamed Hanged",
    p.completed +
      "/100 battles · Pale Squirrel " +
      (s.squirrel ? "defeated" : "not defeated"),
    p.wins +
      "/75 wins · " +
      Object.keys(p.kills).length +
      "/8 species · defeat mini boss",
    "30 kills of each of 8 species",
    "50 kills of each of 9 species · party of four, level 60+",
  ][map - 1];
}
function squirrel(): Actor {
  return {
    id: "foe_0",
    templateId: "pale_squirrel",
    name: "Pale Squirrel",
    kind: "enemy",
    side: "enemy",
    position: 0,
    level: 1,
    stats: { HP: 1, ATK: 0, MATK: 0, DEF: 0, ACC: 100, CRIT: 0, EVA: 0 },
    hp: 1,
    shield: 0,
    mp: 0,
    turns: 0,
    statuses: [],
    immune: {},
    abilities: {
      skill: {
        name: "Quick Escape",
        mp: 0,
        coef: 0,
        stat: "ATK",
        targets: 0,
        hits: 1,
        mode: "damage",
        element: "Physical",
      },
      bonus: {},
    },
    mods: {},
    flying: false,
    ranged: false,
    spawnRound: 0,
    channel: false,
    frenzied: false,
    counterReady: 0,
    critReady: false,
    debt: 0,
  };
}
export function startBattle(
  s: GameState,
  map: number,
  kind: BattleKind,
  utc: number,
  automatic = false,
): void {
  if (s.battle) throw Error("Battle already active");
  if (Object.keys(s.pending).length)
    throw Error("Store pending rewards before farming");
  if (!Number.isInteger(map) || map < 1 || map > s.unlockedMap)
    throw Error("Map locked");
  const party = s.characters
    .filter((c) => c.party !== null)
    .sort((a, b) => a.party! - b.party!);
  if (!party.length) throw Error("Assign a character to the party");
  resetDay(s, utc);
  if (kind === "boss") {
    if (!bossReady(s, map)) throw Error("Boss requirements not met");
    if (s.quota.wins[map - 1] >= 3) throw Error("Daily boss limit reached");
    if (map === 10 && (party.length !== 4 || party.some((c) => c.level < 60)))
      throw Error("Boss 10 needs four characters at level 60+");
  }
  if (
    kind === "hidden" &&
    (map !== 6 || !s.hidden.discovered || s.hidden.defeated)
  )
    throw Error("Hidden encounter unavailable");
  if (kind === "mini" && (map !== 8 || !miniReady(s)))
    throw Error("Mini boss unavailable");
  if (kind === "squirrel" && !automatic)
    throw Error("Squirrel is a random encounter");
  let selected: Actor[] = [];
  if (kind === "squirrel") selected = [squirrel()];
  else if (kind !== "normal") {
    const e = enemies.find((e) => e.map === map && e.kind === kind);
    if (!e) throw Error("Missing encounter");
    selected = [enemyActor(e.id, 0)];
  } else {
    const pool = enemies.filter((e) => e.map === map && e.kind === "normal"),
      n = integer(s.rng.encounter, 1, 4),
      keeper =
        map === 10 && chance(s.rng.encounter, 0.1)
          ? integer(s.rng.encounter, 0, n - 1)
          : -1;
    for (let i = 0; i < n; i++) {
      const e =
        map === 10
          ? i === keeper
            ? pool.find((e) => e.name === "Void Relic Keeper")!
            : pick(
                s.rng.encounter,
                pool.filter((e) => e.name !== "Void Relic Keeper"),
              )
          : map === 8
            ? pool[
                weighted(
                  s.rng.encounter,
                  pool.map((e) => (e.name === "Cursed Reliquary" ? 35 : 95)),
                )
              ]
            : pick(s.rng.encounter, pool);
      selected.push(enemyActor(e.id, i));

    }
  }
  s.battle = {
    id: "battle_" + s.nextId++,
    map,
    kind,
    actors: [...party.map((c) => actorFromCharacter(s, c)), ...selected],
    round: 1,
    queue: [],
    turn: 0,
    time: 0,
    next: 2000,
    phase: "opening",
    action: null,
    result: null,
    log: ["Entering " + content.mapNames[map - 1] + "."],
    kills: [],
    critActions: 0,
    casts: 0,
    startedAt: utc,
    openingDone: false,
  };
  if (kind === "normal") s.farming = map;
  else if (kind !== "squirrel") s.farming = null;
  s.maps[map - 1].bossUnlocked = bossReady(s, map);
}
function dailyWin(s: GameState, b: Battle, gather: number): void {
  const killed = b.actors
    .filter((a) => b.kills.includes(a.id) && a.kind === "enemy")
    .map((a) => a.templateId);
  s.daily.species = [...new Set([...s.daily.species, ...killed])];
  const values = [
    1,
    killed.length,
    gather,
    b.critActions,
    b.casts,
    s.daily.species.length,
  ];
  for (const a of s.daily.tasks) {
    if (a.done) continue;
    const t = content.daily.find((t) => t.id === a.id)!;
    const target = a.target ?? dailyTarget(t.target);
    a.target = target;
    a.progress = Math.min(
      target,
      t.group === 5 ? values[5] : a.progress + values[t.group],
    );
    if (a.progress >= target) {
      a.done = true;
      s.rewards.push("Daily " + t.name + " completed.");
    }
  }
}
export function settle(
  s: GameState,
  utc: number,
  timeout = false,
  idle = false,
): void {
  const b = s.battle;
  if (!b || !b.result) return;
  resetDay(s, utc);
  const p = s.maps[b.map - 1],
    win = b.result === "win",
    normal = b.kind === "normal";
  for (const actor of b.actors.filter(a => a.kind === "enemy")) { if (!p.seen.includes(actor.templateId)) p.seen.push(actor.templateId); }
  let gold = 0,
    exp = 0,
    gather = 0;
  const loot: Record<string, bigint> = {},
    give = (name: string, q = 1) => {
      const id = "mat_" + slug(name);
      loot[id] = (loot[id] ?? 0n) + BigInt(q);
    };
  if (normal) {
    p.completed = (amount(p.completed) + 1n).toString();
    p.streak = win ? (amount(p.streak) + 1n).toString() : "0";
    if (win) p.wins = (amount(p.wins) + 1n).toString();
  }
  if (win && b.kind === "squirrel") s.squirrel = true;
  if (win && b.kind !== "squirrel") {
    for (const a of b.actors.filter((a) => a.kind === "enemy")) {
      const e = enemyById[a.templateId],
        rate = normal ? 0.1 : 0.05;
      gold += integer(
        s.rng.loot,
        Math.ceil(e.gold * (1 - rate)),
        Math.floor(e.gold * (1 + rate)),
      );
      exp += integer(
        s.rng.loot,
        Math.ceil(e.exp * (1 - rate)),
        Math.floor(e.exp * (1 + rate)),
      );
      if (normal) {
        if (b.kills.includes(a.id)) {
          add(p.kills, e.id, 1n);
          if (b.map >= 2 && chance(s.rng.loot, 0.015 * content.rewardBalance.materialDropMultiplier * content.rewardBalance.normalMaterialDropMultiplier * content.rewardBalance.enhancementStoneDropMultiplier))
            give("Enhancement Stone", b.map < 5 ? 1 : b.map < 8 ? 2 : 3);
        }
        if (b.map === 1) {
          const m =
            e.name === "Ash Wolf"
              ? "Raw Hide"
              : e.name === "Rotting Skeleton"
                ? "Rotten Bone Shard"
                : e.name === "Snake"
                  ? "Snake Scale"
                  : pick(s.rng.loot, ["Dry Wood", "Torn Cloth"]);
          if (chance(s.rng.loot, 0.25 * content.rewardBalance.materialDropMultiplier * content.rewardBalance.normalMaterialDropMultiplier)) {
            give(m);
            gather++;
          }
        } else
          e.drops.forEach((d, i) => {
            if (d !== "—" && chance(s.rng.loot, (i === 0 ? 0.25 : 0.1) * content.rewardBalance.materialDropMultiplier * content.rewardBalance.normalMaterialDropMultiplier)) {
              give(d);
              gather++;
            }
          });
      }
    }
    if (normal) {
      if (chance(s.rng.loot, content.rewardBalance.normalSummonTicketChance)) {
        s.tickets = (amount(s.tickets) + 1n).toString();
        b.log.push("Drop · Summon Ticket ×1");
      }
      if (chance(s.rng.loot, (b.map === 1 ? 0.25 : 0.2) * content.rewardBalance.materialDropMultiplier * content.rewardBalance.normalMaterialDropMultiplier)) {
        give(content.tiers[b.map - 1] + " Scrap");
        gather++;
      }
      if (b.map === 1 && chance(s.rng.loot, 0.15 * content.rewardBalance.materialDropMultiplier * content.rewardBalance.normalMaterialDropMultiplier)) {
        give(pick(s.rng.loot, ["Dry Wood", "Torn Cloth"]));
        gather++;
      }
    }
    if (b.kind === "boss") {
      s.quota.wins[b.map - 1]++;
      p.bossDefeated = true;
      if (b.map !== 4 && b.map < 10)
        s.unlockedMap = Math.max(s.unlockedMap, b.map + 1);
      if (b.map === 10) s.chapterCleared = true;
      if (chance(s.rng.loot, 0.8 * content.rewardBalance.materialDropMultiplier)) give(
        bossRewardMaterials[b.map - 1],
      );
      if (chance(s.rng.loot, 0.15))
        s.tickets = (amount(s.tickets) + 1n).toString();
      if (b.map >= 2 && chance(s.rng.loot, 0.12 * content.rewardBalance.materialDropMultiplier * content.rewardBalance.enhancementStoneDropMultiplier))
        give("Enhancement Stone", b.map < 5 ? 2 : b.map < 8 ? 4 : 6);
      if (b.map === 6 && chance(s.rng.loot, 0.08 * content.rewardBalance.materialDropMultiplier)) give("Gallows Ember");
    }
    if (b.kind === "hidden") {
      s.hidden.defeated = true;
      give("Nameless Seal");
    }
    if (b.kind === "mini") {
      s.miniCleared = true;
      give("Castellan Sigil");
    }
    gold = Math.round(gold * content.rewardBalance.goldRewardMultiplier);
    exp = Math.floor(Math.floor(exp * 0.7) * 1.15);
    s.gold = (amount(s.gold) + BigInt(gold)).toString();
    for (const c of s.characters) {
      const a = b.actors.find((a) => a.id === c.id);
      if (a && a.hp > 0) awardExp(c, exp);
    }
    for (const [id, q] of Object.entries(loot)) {
      receive(s, id, q);
      b.log.push(`Drop · ${materialById[id]?.name ?? id} ×${q}${s.pending[id] ? " · Pending" : ""}`);
    }
    if (!Object.keys(loot).length) b.log.push("Drop · No materials this battle.");
    if (normal) dailyWin(s, b, gather);
  }
  if (b.map === 4 && amount(p.streak) >= 40n)
    s.unlockedMap = Math.max(s.unlockedMap, 5);
  let pause = false;
  if (normal && win && b.map === 6 && !s.hidden.discovered) {
    s.hidden.count++;
    if (chance(s.rng.encounter, 0.05) || s.hidden.count >= s.hidden.pity) {
      s.hidden.discovered = true;
      s.rewards.push("Hidden encounter discovered: The Unnamed Hanged.");
      pause = !idle;
    }
  }
  for (let i = 1; i <= s.unlockedMap; i++)
    s.maps[i - 1].bossUnlocked = bossReady(s, i);
  s.rewards.push(
    (timeout ? "Idle cutoff · " : "") +
      (win ? "Victory" : b.result === "escape" ? "Escaped" : "Defeat") +
      " · " +
      content.mapNames[b.map - 1] +
      " · " +
      gold +
      " Gold · " +
      exp +
      " EXP",
  );
  s.rewards = s.rewards.slice(-100);
  b.log.push(`${win ? "Victory" : "Battle ended"} · ${gold} Gold · ${exp} EXP`);
  s.completedBattle = b;
  s.battle = null;
  s.restUntil = utc + 2000;
  if (Object.keys(s.pending).length || pause) s.farming = null;
  if (
    normal &&
    b.map === 7 &&
    s.farming &&
    !Object.keys(s.pending).length &&
    chance(s.rng.encounter, 0.1)
  )
    startBattle(s, 7, "squirrel", utc + 2000, true);
}
export function characterMap(s: GameState, id: string): number | null {
  const archived = s.expeditions?.find(e => e.partyIds.includes(id));
  if (archived) return archived.map;
  const c = s.characters.find(c => c.id === id);
  return c?.party !== null && c?.party !== undefined ? s.battle?.map ?? s.farming ?? null : null;
}
export function captureExpedition(s: GameState): import("../core/types").Expedition | null {
  const map = s.battle?.map ?? s.farming;
  return map ? {map, partyIds:s.characters.filter(c=>c.party!==null).sort((a,b)=>a.party!-b.party!).map(c=>c.id), battle:s.battle, farming:s.farming, restUntil:s.restUntil, completedBattle:s.completedBattle} : null;
}
export function restoreExpedition(s: GameState, e: import("../core/types").Expedition): void {
  s.characters.forEach(c=>{c.party=null;});
  e.partyIds.forEach((id,slot)=>{const c=s.characters.find(c=>c.id===id);if(c)c.party=slot;});
  s.battle=e.battle; s.farming=e.farming; s.restUntil=e.restUntil; s.completedBattle=e.completedBattle;
}
export function advanceTo(s: GameState, target: number, idle=false, budget=20000): boolean {
  let done = advanceSingle(s,target,idle,budget);
  const foreground = {battle:s.battle,farming:s.farming,restUntil:s.restUntil,completedBattle:s.completedBattle};
  const party = s.characters.map(c=>c.party);
  const archived = s.expeditions ?? [];
  s.expeditions = [];
  for (const e of archived) {
    restoreExpedition(s,e);
    const complete = advanceSingle(s,target,true,budget);
    done = complete && done;
    const current = captureExpedition(s);
    if(current) s.expeditions.push(current);
  }
  Object.assign(s,foreground);
  s.characters.forEach((c,i)=>{c.party=party[i];});
  return done;
}
function advanceSingle(
  s: GameState,
  target: number,
  idle = false,
  budget = 20000,
): boolean {
  let count = 0;
  while (count++ < budget) {
    if (!s.battle) {
      if (!s.farming || s.restUntil > target) {
        resetDay(s, target);
        return true;
      }
      startBattle(s, s.farming, "normal", s.restUntil, true);
    }
    const b = s.battle!,
      event = b.startedAt + nextEventTime(b);
    if (b.result) {
      const until = idle ? event : (b.presentationUntil ?? event);
      if (until > target) return true;
      settle(s, until, false, idle);
      continue;
    }
    if (event > target) {
      resetDay(s, target);
      return true;
    }
    const previousVisual = b.visualSequence ?? 0;
    stepBattle(s);
    if (b.result) {
      if (idle) settle(s, event, false, true);
      else { b.presentationUntil = event + 900; return false; }
    }
    if (!idle && (b.visualSequence ?? 0) > previousVisual) return false;
  }
  return false;
}
export function finishIdle(s: GameState, cutoff: number): void {
  finishSingleIdle(s,cutoff);
  const foreground={battle:s.battle,farming:s.farming,restUntil:s.restUntil,completedBattle:s.completedBattle};
  const party=s.characters.map(c=>c.party);
  const archived=s.expeditions ?? [];s.expeditions=[];
  for(const e of archived) {restoreExpedition(s,e);finishSingleIdle(s,cutoff);const current=captureExpedition(s);if(current)s.expeditions.push(current);}
  Object.assign(s,foreground);s.characters.forEach((c,i)=>{c.party=party[i];});
}
function finishSingleIdle(s: GameState, cutoff: number): void {
  if (
    s.battle?.kind === "normal" &&
    !s.battle.result &&
    s.battle.startedAt < cutoff
  ) {
    s.battle.result = "win";
    settle(s, cutoff, true, true);
  }
  s.idle = null;
}
/** Persist this job BEFORE stepping it. A crash resumes the same cutoff and cap flag. */
export function beginIdle(
  s: GameState,
  previous: number,
  verifiedElapsed: number,
): void {
  if (s.idle || (!s.farming && !s.expeditions?.some(e=>e.farming)) || verifiedElapsed <= 1000) return;
  s.idle = {
    cutoff: previous + Math.min(verifiedElapsed, 14400000),
    cursor: previous,
    capped: verifiedElapsed >= 14400000,
  };
}
export function stepIdle(s: GameState, budget = 200): boolean {
  if (!s.idle) return true;
  const { cutoff, capped } = s.idle,
    done = advanceTo(s, cutoff, true, budget);
  s.idle.cursor = s.battle
    ? s.battle.startedAt + s.battle.time
    : Math.min(cutoff, s.restUntil);
  if (!done) return false;
  if (capped) finishIdle(s, cutoff);
  s.idle = null;
  const shift = Math.max(0, s.clock.gameUtc - cutoff);
  if (s.battle) s.battle.startedAt += shift;
  s.restUntil += shift;
  for(const e of s.expeditions ?? []) {if(e.battle)e.battle.startedAt += shift;e.restUntil += shift;}
  return true;
}
