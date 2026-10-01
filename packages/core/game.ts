import { content, recipeById, slots } from "../content";
import type { BaseClass, ClockAnchor, Command, GameState } from "./types";
import { streams, integer, pick, chance } from "./random";
import { choices, createCharacter } from "../characters";
import {
  amount,
  receive,
  add,
  used,
  bagCost,
  goldSpend,
  craft,
  storePending,
  sell,
  enhancementCost,
  STONE,
} from "../economy";
import { dayId, resetDay, startBattle, settle, characterMap, captureExpedition, restoreExpedition } from "../world";
export function rosterSlotCost(capacity: number): bigint {
  const price = content.rosterPrices[capacity];
  if (!Number.isSafeInteger(price) || price <= 0) throw Error("Roster maximum reached");
  const current = BigInt(Math.max(100, Math.round((Math.round(price * 0.7 / 100) * 100) * 0.7 / 100) * 100));
  return BigInt(Math.max(100, Math.round(Number(current) * 0.7 / 100) * 100));
}
export function newGame(seed: bigint, clock: ClockAnchor): GameState {
  const s: GameState = {
    schemaVersion: 1,
    contentVersion: "R67",
    saveId: "abyss_" + seed.toString(16),
    revision: 0,
    nextId: 1,
    gold: "100",
    tickets: "1",
    rosterCapacity: 1,
    capacity: "100",
    characters: [],
    equipment: [],
    materials: {},
    pending: {},
    unlockedMap: 1,
    maps: Array.from({ length: 10 }, () => ({
      wins: "0",
      completed: "0",
      streak: "0",
      seen: [],
      kills: {},
      bossUnlocked: false,
      bossDefeated: false,
    })),
    hidden: { pity: 100, count: 0, discovered: false, defeated: false },
    squirrel: false,
    miniCleared: false,
    chapterCleared: false,
    daily: { day: -1, tier: 1, tasks: [], species: [], ticketGranted: false },
    quota: { day: dayId(clock.gameUtc), wins: Array(10).fill(0) },
    rng: streams(seed),
    clock,
    battle: null,
    farming: null,
    restUntil: clock.gameUtc,
    receipts: [],
    rewards: [
      "Welcome. Your journey starts with a Warrior, 100 Gold and one Summon Ticket.",
    ],
    settings: { music: 0, sfx: 0.4 },
    idle: null,
  };
  s.characters.push(createCharacter(s, "Warrior", true));
  s.hidden.pity = integer(s.rng.encounter, 100, 120);
  resetDay(s, clock.gameUtc);
  return s;
}
export function execute(
  input: GameState,
  cmd: Command,
  id: string,
  expected = input.revision,
): GameState {
  if (input.receipts.includes(id)) return input;
  if (input.revision !== expected) throw Error("State changed. Try again.");
  if (input.idle) throw Error("Offline recovery is still running");
  const s = structuredClone(input);
  resetDay(s, s.clock.gameUtc);
  if ((cmd.type === "leave" || cmd.type === "start") && s.battle?.result)
    settle(s, s.clock.gameUtc);
  if (cmd.type === "start") {
    delete s.completedBattle;
    if (s.farming === cmd.map || s.battle?.map === cmd.map || s.expeditions?.some(e=>e.map===cmd.map)) throw Error("This map is already in combat");
    if (cmd.partyIds) {
      if (!cmd.partyIds.length || cmd.partyIds.length > 4 || new Set(cmd.partyIds).size !== cmd.partyIds.length)
        throw Error("Choose one to four unique characters");
      const activeElsewhere = new Set(s.characters.filter(c => characterMap(s,c.id)!==null).map(c=>c.id));
      if (cmd.partyIds.some(id => !s.characters.some(c => c.id === id) || activeElsewhere.has(id)))
        throw Error("Character is unavailable in another map");
      const previous = captureExpedition(s);
      if(previous) (s.expeditions ??= []).push(previous);
      s.characters.forEach(c => { c.party = null; });
      cmd.partyIds.forEach((id, slot) => { s.characters.find(c => c.id === id)!.party = slot; });
    } else if (s.farming || s.battle || s.expeditions?.length) throw Error("Choose a party to switch maps");
    s.battle = null;
    s.farming = null;
    startBattle(s, cmd.map, cmd.kind, s.clock.gameUtc);
  } else if (cmd.type === "resume") {
    const index = s.expeditions?.findIndex(e=>e.map===cmd.map) ?? -1;
    if(index < 0) throw Error("No expedition in this map");
    const next = s.expeditions!.splice(index,1)[0];
    const previous = captureExpedition(s);
    if(previous) s.expeditions!.push(previous);
    restoreExpedition(s,next);
  } else if (cmd.type === "leave") {
    delete s.completedBattle;
    if (s.battle?.kind === "normal") s.maps[s.battle.map - 1].streak = "0";
    s.battle = null;
    s.farming = null;
    s.characters.forEach(c=>{c.party=null;});
  } else if (cmd.type === "settings")
    s.settings = {
      music: Math.min(1, Math.max(0, cmd.music)),
      sfx: Math.min(1, Math.max(0, cmd.sfx)),
    };
  else if (cmd.type === "roster-slot") {
    if (s.rosterCapacity >= 30) throw Error("Roster maximum reached");
    goldSpend(s, rosterSlotCost(s.rosterCapacity));
    s.rosterCapacity++;
  } else if (cmd.type === "claim-daily") {
    const m = cmd.milestone;
    if (![1,3,5].includes(m) || s.daily.tasks.filter(t => t.done).length < m || s.daily.claimedMilestones?.includes(m)) throw Error("Daily reward unavailable");
    s.daily.claimedMilestones ??= [];
    s.daily.claimedMilestones.push(m);
    if (m === 1) s.gold = (amount(s.gold) + 500n).toString();
    if (m === 3) receive(s, STONE, 5n);
    if (m === 5) { s.tickets = (amount(s.tickets) + 1n).toString(); s.daily.ticketGranted = true; }
    s.rewards.push(`Daily milestone ${m}: ${m === 1 ? "500 Gold" : m === 3 ? "5 Enhancement Stones" : "1 Summon Ticket"}`);
  } else if (cmd.type === "bag-slot") {
    goldSpend(s, bagCost(s));
    s.capacity = (amount(s.capacity) + 5n).toString();
  } else if (cmd.type === "store-pending") storePending(s);
  else if (cmd.type === "advance") {
    const c = s.characters.find(c => c.id === cmd.id);
    if (!c || !choices(c).includes(cmd.className)) throw Error("Class advancement unavailable");
    c.className = cmd.className;
    c.exp = 0;
    c.classLevel = 1;
    c.classExp = 0;
  }
  else if (cmd.type === "dismiss") {
    const c = s.characters.find(c => c.id === cmd.id);
    if (!c || s.characters.length <= 1) throw Error("Cannot dismiss the last character");
    if (c.party !== null || characterMap(s,c.id)!==null) throw Error("Remove from party first");
    const gear = s.equipment.filter(e => e.owner === c.id);
    if (used(s) + BigInt(gear.length) > amount(s.capacity)) throw Error("Not enough room to return equipment");
    gear.forEach(e => e.owner = null);
    s.characters = s.characters.filter(x => x !== c);
  }
  else if (cmd.type === "craft") craft(s, cmd.id);
  else if (cmd.type === "sell") sell(s, cmd.id, cmd.quantity);
  else if (["equip", "unequip", "enhance"].includes(cmd.type)) {
    switch (cmd.type) {
      case "equip": {
        const e = s.equipment.find((e) => e.id === cmd.id),
          c = s.characters.find((c) => c.id === cmd.character);
        if (!e || !c || e.owner) throw Error("Equipment unavailable");
        const r = recipeById[e.templateId];
        if (r.baseClass !== "All" && r.baseClass !== c.baseClass)
          throw Error("Wrong class");
        const slot = r.slot as (typeof slots)[number],
          old = s.equipment.find((e) => e.id === c.gear[slot]);
        if (old) old.owner = null;
        e.owner = c.id;
        c.gear[slot] = e.id;
        break;
      }
      case "unequip": {
        const e = s.equipment.find((e) => e.id === cmd.id);
        if (!e || !e.owner) throw Error("Not equipped");
        if (used(s) >= amount(s.capacity)) throw Error("Inventory full");
        const c = s.characters.find((c) => c.id === e.owner)!;
        delete c.gear[recipeById[e.templateId].slot as (typeof slots)[number]];
        e.owner = null;
        break;
      }
      case "enhance": {
        const e = s.equipment.find((e) => e.id === cmd.id);
        if (!e) throw Error("Unknown equipment");
        const cost = enhancementCost(e);
        goldSpend(s, cost.gold);
        add(s.materials, STONE, -cost.stones);
        const ok = chance(s.rng.enhance, cost.chance / 100);
        if (ok) e.enhancement++;
        s.rewards.push(
          ok
            ? "Enhancement succeeded: +" + e.enhancement
            : "Enhancement failed. Level retained.",
        );
        break;
      }
    }
  } else if (cmd.type === "summon") {
    if (amount(s.tickets) < 1n) throw Error("Not enough Summon Tickets");
    if (s.characters.length >= s.rosterCapacity) throw Error("Roster is full. Open another slot first.");
    s.tickets = (amount(s.tickets) - 1n).toString();
    s.characters.push(createCharacter(s, pick(s.rng.summon, ["Warrior", "Mage", "Rogue"] as BaseClass[])));
  } else {
    if (s.battle || s.farming || s.expeditions?.length) throw Error("Leave the map first");
    switch (cmd.type) {
      case "party": {
        const c = s.characters.find((c) => c.id === cmd.id);
        if (
          !c ||
          (cmd.slot !== null &&
            (!Number.isInteger(cmd.slot) || cmd.slot < 0 || cmd.slot > 3))
        )
          throw Error("Invalid party slot");
        if (cmd.slot !== null) {
          const old = s.characters.find((c) => c.party === cmd.slot);
          if (old) old.party = null;
        }
        c.party = cmd.slot;
        break;
      }
    }
  }
  s.revision++;
  s.receipts.push(id);
  return s;
}
