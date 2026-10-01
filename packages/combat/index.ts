import type {
  Actor,
  Abilities,
  Battle,
  GameState,
  Skill,
  Stats,
  Status,
  Action,
} from "../core/types";
import { chance, integer } from "../core/random";
import { baseStats, enemyById } from "../content";
import { enemyAbilities } from "../content/abilities";
export const clamp = (x: number, a: number, b: number) =>
  Math.max(a, Math.min(b, x));
const live = (a: Actor) => a.hp > 0;
const status = (a: Actor, n: string) => a.statuses.find((x) => x.name === n);
const mod = (a: Actor, n: string) => a.mods[n] ?? 0;
const cycle = (a: Actor) =>
  a.cycleReady ??
  (a.turns > 0 && !!a.abilities.cycle && a.turns % a.abilities.cycle === 0);
const allies = (b: Battle, a: Actor) =>
  b.actors.filter((x) => live(x) && x.side === a.side);
const opponents = (b: Battle, a: Actor) =>
  b.actors.filter((x) => live(x) && x.side !== a.side);
export function log(b: Battle, text: string): void {
  b.log.push(text);
  if (b.log.length > 200) b.log.splice(0, b.log.length - 200);
}
function visual(b: Battle, source: Actor, target: Actor, value: number): void {
  if (!value) return;
  const action = b.action;
  b.visualSequence = (b.visualSequence ?? 0) + 1;
  (b.visualEvents ??= []).push({ sequence:b.visualSequence, source:source.id, target:target.id, value, skill:!!action?.isSkill, action:`${source.id}|${action?.start ?? b.time}`, at:b.time });
  b.visualEvents = b.visualEvents.slice(-40);
}
export function enemyActor(id: string, index: number): Actor {
  const e = enemyById[id],
    stats = Object.fromEntries(Object.entries(e.stats).map(([k, v]) => [k, Math.ceil(Math.ceil(v * 1.25) * 1.25)])) as Stats;
  return {
    id: "foe_" + index,
    templateId: id,
    name: e.name,
    side: "enemy",
    kind: "enemy",
    position: index,
    level: e.level,
    stats,
    hp: stats.HP,
    shield: 0,
    mp: 0,
    turns: 0,
    statuses: [],
    immune: {},
    abilities: enemyAbilities(e),
    mods: {},
    flying: e.flying,
    ranged: e.ranged,
    spawnRound: 0,
    channel: false,
    frenzied: false,
    counterReady: 0,
    critReady: false,
    debt: 0,
  };
}
export function outcome(b: Battle): boolean {
  for (const a of b.actors)
    if (a.owner && !b.actors.some((o) => o.id === a.owner && live(o))) a.hp = 0;
  if (!b.actors.some((a) => a.kind === "character" && live(a))) {
    b.result = "loss";
    return true;
  }
  const leader = b.actors.find((a) => a.kind === "enemy" && a.side === "enemy");
  if (
    (b.kind === "boss" && leader && !live(leader)) ||
    !b.actors.some((a) => a.side === "enemy" && live(a))
  ) {
    b.result = "win";
    return true;
  }
  return false;
}
function death(b: Battle, a: Actor): void {
  if (a.hp <= 0) {
    a.hp = 0;
    log(b, a.name + " fell.");
    if (a.kind === "enemy" && !b.kills.includes(a.id)) b.kills.push(a.id);
    for (const u of b.actors.filter((x) => x.owner === a.id)) u.hp = 0;
  } else if (
    a.abilities.frenzy &&
    !a.frenzied &&
    a.hp <= a.stats.HP * (a.abilities.frenzyThreshold ?? 0)
  ) {
    a.frenzied = true;
    log(b, a.name + " enters Frenzy.");
  }
}
function heal(
  b: Battle,
  source: Actor,
  target: Actor,
  value: number,
  restoration = true,
): number {
  if (!live(target)) return 0;
  const wither = status(target, "Wither")?.raw ?? 0;
  const n = Math.min(
    target.stats.HP - target.hp,
    Math.max(
      1,
      Math.floor(
        value *
          (1 + (restoration ? mod(source, "Restoration") : 0)) *
          (1 - wither + (wither ? mod(target, "Mercy") : 0)),
      ),
    ),
  );
  target.hp += n;
  visual(b, source, target, n);
  if (n) log(b, source.name + " restores " + n + " HP to " + target.name + ".");
  return n;
}
function shield(b: Battle, source: Actor, target: Actor, value: number): void {
  if (!live(target)) return;
  const v = Math.max(1, Math.floor(value * (1 + mod(source, "Warding"))));
  target.shield = Math.max(target.shield, v);
  log(b, target.name + " gains Shield " + v + ".");
}
function ledger(b: Battle, healed: boolean): void {
  if (healed)
    for (const a of b.actors)
      if (a.name === "The Ossuary Sovereign" && live(a))
        a.debt = Math.min(6, a.debt + 1);
}
export function cleanse(a: Actor, gear = false): void {
  const i = a.statuses.findIndex((s) => !gear || s.name !== "Taunt");
  if (i < 0) return;
  const st = a.statuses.splice(i, 1)[0];
  if (["Stun", "Skill Seal"].includes(st.name)) a.immune[st.name] = a.turns + 1;
}
export function applyStatus(
  s: GameState,
  b: Battle,
  source: Actor,
  target: Actor,
  name: string,
  raw = 0,
): void {
  const a = target;
  if (name === "Taunt")
    for (const other of b.actors.filter((x) => x.side === source.side))
      other.statuses = other.statuses.filter((x) => x.name !== "Taunt");
  const existing = status(a, name);
  if (
    (a.immune[name] ?? -1) >= a.turns ||
    (name === "Stun" && a.abilities.stunImmune) ||
    (["Stun", "Skill Seal"].includes(name) && existing)
  )
    return;
  const cc = ["Stun", "Slow"].includes(name),
    dot = ["Poison", "Burn", "Bleeding"].includes(name);
  const resistance =
    dot || ["Trap", "Doom Mark", "Taunt"].includes(name)
      ? 0
      : clamp(
          mod(a, name + "Res") +
            mod(a, cc ? "CCRes" : "DebuffRes") +
            (name === "Stun" ? (a.abilities.stunRes ?? 0) : 0),
          0,
          0.5,
        );
  if (resistance && chance(s.rng.combat, resistance)) {
    log(b, a.name + " resists " + name + ".");
    return;
  }
  const remaining = ["Stun", "Slow"].includes(name)
    ? chance(s.rng.combat, 0.7)
      ? 2
      : 3
    : name === "Poison"
      ? 3
      : ["Skill Seal", "Trap"].includes(name)
        ? 1
        : ["Burn", "Bleeding"].includes(name)
          ? 6
          : 2;
  if (name === "Wither") raw = 0.3;
  if (name === "Darkness") raw = 0.4;
  if (["Weaken", "Defense Break"].includes(name)) raw = 0.15;
  if (existing) {
    if (dot || ["Trap", "Doom Mark"].includes(name)) {
      if (raw < existing.raw) return;
      existing.raw = raw;
      existing.source = source.id;
      existing.remaining = remaining;
      existing.appliedTurn = a.turns;
      existing.nextTick = b.time + 1000;
      return;
    }
    existing.remaining = Math.max(existing.remaining, remaining);
    existing.appliedTurn = a.turns;
    return;
  }
  a.statuses.push({
    name,
    raw,
    remaining,
    source: source.id,
    appliedTurn: a.turns,
    nextTick: b.time + 1000,
  });
  if (["Stun", "Skill Seal"].includes(name)) a.channel = false;
  if (name === "Slow") {
    // Preserve side alternation: move only among remaining slots of this side.
    const positions = b.queue
      .map((id, i) => ({ id, i }))
      .filter(
        ({ id, i }) =>
          i > b.turn && b.actors.find((x) => x.id === id)?.side === a.side,
      );
    const ids = positions.map((x) => x.id);
    if (ids.includes(a.id)) {
      const reordered = [...ids.filter((id) => id !== a.id), a.id];
      positions.forEach(({ i }, index) => {
        b.queue[i] = reordered[index];
      });
    }
  }
  log(b, a.name + " receives " + name + ".");
}
function combatStat(b: Battle, a: Actor, k: "ATK" | "MATK"): number {
  let v = a.stats[k] * (1 - (status(a, "Weaken")?.raw ?? 0));
  if (a.frenzied && (k === "ATK" || a.name === "The Abyssal Regent"))
    v *= 1 + (a.abilities.frenzy ?? 0);
  if (
    a.abilities.group &&
    k === "ATK" &&
    allies(b, a).some((x) => x.id !== a.id && x.templateId === a.templateId)
  )
    v *= 1 + a.abilities.group;
  return v;
}
export function damageValue(
  level: number,
  raw: number,
  def: number,
  pierce: number,
  dr: number,
): number {
  const k = 100 + 10 * (level - 1);
  return Math.max(
    1,
    Math.floor(
      ((raw * k) / (k + Math.max(0, def) * (1 - clamp(pierce, 0, 0.5)))) *
        (1 - clamp(dr, 0, 0.5)),
    ),
  );
}
function reduce(
  b: Battle,
  source: Actor,
  target: Actor,
  raw: number,
  element: string,
  pierce = 0,
  noDef = false,
  resist = 0,
  block = 0,
): number {
  let factor = 1;
  if (target.name === "Walking Rotcap" && element === "Fire") factor = 1.1;
  if (
    target.name === "Void Relic Keeper" &&
    ["Fire", "Ice", "Lightning"].includes(element)
  )
    factor = 0.8;
  const physical = element === "Physical",
    magic = ["Arcane", "Fire", "Ice", "Lightning", "Shadow"].includes(element);
  let dr =
    (target.abilities.dr ?? 0) +
    (physical
      ? (target.abilities.physicalDR ?? 0) + mod(target, "PhysicalDR")
      : magic
        ? mod(target, "ElementalDR")
        : 0);
  if (target.abilities.ward) {
    const phase = Math.floor(Math.max(0, target.turns - 1) / 2) % 2;
    if ((physical && phase === 0) || (magic && phase === 1))
      dr += target.abilities.ward;
  }
  const k = 100 + 10 * (source.level - 1),
    def = target.stats.DEF * (1 - (status(target, "Defense Break")?.raw ?? 0));
  return Math.max(
    1,
    Math.floor(
      raw *
        factor *
        (noDef ? 1 : k / (k + def * (1 - clamp(pierce, 0, 0.5)))) *
        (1 - block) *
        (1 - clamp(dr, 0, 0.5)) *
        (1 - clamp(resist, 0, 0.5)),
    ),
  );
}
export function absorb(
  a: Actor,
  damage: number,
  shieldBreak = 0,
): { hp: number; shield: number } {
  const before = a.shield,
    b = clamp(shieldBreak, 0, 0.4),
    sh = Math.min(before, Math.floor(damage * (1 + b))),
    hp = Math.min(a.hp, Math.max(0, damage - Math.ceil(before / (1 + b))));
  a.shield -= sh;
  a.hp -= hp;
  return { hp, shield: sh };
}
function rawHit(
  b: Battle,
  source: Actor,
  target: Actor,
  raw: number,
  element: string,
  noDef = false,
  resist = 0,
): number {
  const d = reduce(b, source, target, raw, element, 0, noDef, resist),
    loss = absorb(target, d);
  visual(b, source, target, -loss.hp);
  log(b, source.name + " → " + target.name + " " + d + " " + element + ".");
  death(b, target);
  return loss.hp;
}
function statusDamage(b: Battle, a: Actor, st: Status): void {
  const src = b.actors.find((x) => x.id === st.source) ?? a,
    dot = ["Poison", "Burn", "Bleeding"].includes(st.name),
    resist = mod(a, st.name + "Res") + (dot ? mod(a, "DOTRes") : 0);
  rawHit(
    b,
    src,
    a,
    st.raw,
    st.name === "Burn"
      ? "Fire"
      : st.name === "Doom Mark"
        ? "Shadow"
        : st.name === "Trap"
          ? "Physical"
          : st.name,
    dot,
    resist,
  );
}
function summon(b: Battle, owner: Actor): void {
  const existing = b.actors.filter((a) => a.owner === owner.id && live(a)),
    player = owner.side === "player",
    max = player || owner.name === "Blackore Tyrant" ? 1 : 2;
  if (
    existing.length >= max ||
    (!player &&
      b.actors.filter((a) => a.side === "enemy" && live(a)).length >= 8)
  )
    return;
  let stats: Stats,
    name: string,
    ab: Abilities,
    ranged = true,
    flying = false;
  if (player) {
    const t = owner.abilities.summon ?? 0,
      base = baseStats(owner.baseClass!, owner.level);
    stats = {
      HP: Math.floor(
        base.HP * [0.5, 0.65, 0.75][t] * (1 + mod(owner, "UnitHP")),
      ),
      ATK: 0,
      MATK: Math.floor(
        base.MATK * [0.5, 0.6, 0.7][t] * (1 + mod(owner, "UnitMATK")),
      ),
      DEF: Math.floor(base.DEF * [0.5, 0.6, 0.7][t]),
      ACC: 100,
      CRIT: 5,
      EVA: 5,
    };
    name = "Dark Unit";
    ab = {
      skill: {
        name: "Dark Pulse",
        mp: 0,
        coef: [1, 1.1, 1.2][t],
        stat: "MATK",
        targets: 3,
        hits: 1,
        mode: "damage",
        element: "Shadow",
      },
      bonus: {},
      dr: [0.1, 0.15, 0.2][t],
    };
  } else {
    name =
      owner.name === "The Abyssal Regent"
        ? "Court Wraith"
        : owner.name === "Blackore Tyrant"
          ? "Ore Spawn"
          : "Rift Spawn";
    const v =
      name === "Court Wraith"
        ? [18000, 0, 275, 197]
        : name === "Ore Spawn"
          ? [1650, 67, 0, 44]
          : [2400, 234, 0, 154];
    stats = {
      HP: v[0],
      ATK: v[1],
      MATK: v[2],
      DEF: v[3],
      ACC: 100,
      CRIT: 0,
      EVA: 0,
    };
    ranged = stats.MATK > 0;
    flying = name === "Court Wraith";
    ab = {
      skill: {
        name: "Strike",
        mp: 0,
        coef: 1,
        stat: ranged ? "MATK" : "ATK",
        targets: 1,
        hits: 1,
        mode: "damage",
        element: ranged ? "Shadow" : "Physical",
      },
      bonus: {},
    };
  }
  b.actors.push({
    id: "unit_" + owner.id + "_" + b.round + "_" + b.actors.length,
    templateId: name,
    name,
    owner: owner.id,
    side: owner.side,
    kind: "unit",
    position: player ? 4 + owner.position : b.actors.length,
    level: owner.level,
    stats,
    hp: stats.HP,
    shield: 0,
    mp: 0,
    turns: 0,
    statuses: [],
    immune: {},
    abilities: ab,
    mods: {},
    ranged,
    flying,
    spawnRound: b.round,
    channel: false,
    frenzied: false,
    counterReady: 0,
    critReady: false,
    debt: 0,
  });
  log(b, owner.name + " summons " + name + ".");
}
const lowest = (list: Actor[]) =>
  [...list].sort(
    (a, b) => a.hp / a.stats.HP - b.hp / b.stats.HP || a.position - b.position,
  );
function periodic(s: GameState, b: Battle, a: Actor): void {
  const ab = a.abilities;
  if (ab.cleanseCycle && a.turns % ab.cleanseCycle === 0) cleanse(a);
  if (
    ["Blackore Tyrant", "The Abyssal Regent"].includes(a.name) &&
    a.turns % 6 === 0
  )
    summon(b, a);
  if (!cycle(a)) return;
  const group = allies(b, a).filter((x) => x.kind !== "unit"),
    v = ab.cycleValue ?? 0;
  switch (ab.cycleType) {
    case "shield":
      shield(b, a, a, a.stats.HP * v);
      break;
    case "counter":
      a.counterReady = v;
      break;
    case "crit":
      a.critReady = true;
      break;
    case "heal": {
      const t = lowest(group)[0];
      if (t)
        ledger(
          b,
          heal(
            b,
            a,
            t,
            combatStat(b, a, "MATK") * v + t.stats.HP * (ab.healHP ?? 0),
          ) > 0 && t.kind === "character",
        );
      break;
    }
    case "cleanse":
      for (const t of lowest(group.filter((x) => x.statuses.length)).slice(
        0,
        v,
      ))
        cleanse(t);
      break;
    case "unitHeal": {
      const u = b.actors.find((x) => x.owner === a.id && live(x));
      if (u) heal(b, a, u, u.stats.HP * v);
      break;
    }
    case "trap":
      for (const t of opponents(b, a)
        .filter((x) => a.ranged || !x.flying)
        .slice(0, v))
        applyStatus(
          s,
          b,
          a,
          t,
          "Trap",
          combatStat(b, a, "ATK") * (a.abilities.skill.statusRaw ?? 0),
        );
      break;
    case "alternating":
      if (Math.floor(a.turns / 5) % 2) shield(b, a, a, a.stats.HP * 0.04);
      else heal(b, a, a, a.stats.HP * 0.02);
      break;
  }
}
function targets(s: GameState, b: Battle, a: Actor, sk: Skill): Actor[] {
  if (sk.mode === "heal" || sk.mode === "shield")
    return lowest(
      allies(b, a).filter((x) => a.side === "enemy" || x.kind === "character"),
    ).slice(0, sk.targets);
  let ts = opponents(b, a).filter((t) => a.ranged || !t.flying);
  // Draw without replacement so party position does not decide the target.
  for (let i = ts.length - 1; i > 0; i--) {
    const j = integer(s.rng.combat, 0, i);
    [ts[i], ts[j]] = [ts[j], ts[i]];
  }
  if (sk.targets === 1) {
    const t = ts.find((t) => status(t, "Taunt"));
    if (t && chance(s.rng.combat, status(t, "Taunt")!.raw))
      ts = [t, ...ts.filter((x) => x !== t)];
  }
  return ts.slice(0, sk.targets);
}
function basic(a: Actor): Skill {
  const magic = a.baseClass === "Mage" || a.stats.ATK === 0;
  return {
    name: "Basic Attack",
    mp: 0,
    coef: 1,
    stat: magic ? "MATK" : "ATK",
    targets: 1,
    hits: 1,
    mode: "damage",
    element: magic ? "Arcane" : "Physical",
  };
}
function endTurn(s: GameState, b: Battle, a: Actor, stunned = false): void {
  b.pendingEnd = { actor: a.id, stunned };
}
function finishTurn(s: GameState, b: Battle, a: Actor, stunned: boolean): void {
  if (
    live(a) &&
    !stunned &&
    a.turns % 4 === 0 &&
    mod(a, "AutoCleanse") &&
    chance(s.rng.combat, Math.min(0.5, mod(a, "AutoCleanse")))
  )
    cleanse(a, true);
  for (const st of [...a.statuses]) {
    if (!live(a)) break;
    if (st.name === "Poison") {
      statusDamage(b, a, st);
      st.remaining--;
    } else if (
      !["Burn", "Bleeding", "Trap", "Doom Mark"].includes(st.name) &&
      st.appliedTurn < a.turns
    )
      st.remaining--;
    if (st.remaining <= 0) {
      a.statuses = a.statuses.filter((x) => x !== st);
      if (["Stun", "Skill Seal"].includes(st.name))
        a.immune[st.name] = a.turns + 1;
    }
  }
  b.action = null;
  b.phase = "turn";
  b.turn++;
  b.next = b.time;
  outcome(b);
}
function action(
  a: Actor,
  b: Battle,
  skill: Skill,
  isSkill: boolean,
  ts: Actor[],
  duration: number,
  pierce = 0,
): Action {
  return {
    actor: a.id,
    targets: ts.map((t) => t.id),
    skill,
    isSkill,
    start: b.time,
    nextHit: b.time + Math.floor(duration / skill.hits),
    hit: 0,
    duration,
    counterChecked: [],
    statusChecked: [],
    block: {},
    crit: false,
    pierce,
    counterQueue: [],
    phase: "hit",
  };
}
function startTurn(s: GameState, b: Battle): void {
  if (b.turn >= b.queue.length) {
    if (b.round >= 30) {
      for (const a of b.actors.filter((a) => a.side === "player")) a.hp = 0;
      log(b, "Enrage — the party is defeated.");
      b.result = "loss";
      return;
    }
    b.round++;
    b.queue = roundQueue(b);
    b.turn = 0;
  }
  const a = b.actors.find((a) => a.id === b.queue[b.turn]);
  if (!a || !live(a)) {
    b.turn++;
    b.next = b.time;
    return;
  }
  a.turns++;
  a.cycleReady = false;
  a.counterReady = 0;
  a.critReady = false;
  for (const st of [...a.statuses])
    if (["Trap", "Doom Mark"].includes(st.name)) {
      st.remaining--;
      if (st.remaining <= 0) {
        a.statuses = a.statuses.filter((x) => x !== st);
        statusDamage(b, a, st);
      }
    }
  if (outcome(b)) return;
  if (!live(a)) {
    endTurn(s, b, a);
    return;
  }
  if (status(a, "Stun")) {
    a.channel = false;
    b.action = action(a, b, basic(a), false, [], 1500);
    b.phase = "end";
    b.next = b.time + 1500;
    log(b, a.name + " is stunned.");
    return;
  }
  a.cycleReady = !!a.abilities.cycle && a.turns % a.abilities.cycle === 0;
  periodic(s, b, a);
  if (outcome(b)) return;
  let skill: Skill,
    isSkill = false;
  const ab = a.abilities;
  if (a.kind === "unit") skill = { ...ab.skill };
  else if (a.channel) {
    skill = { ...ab.skill };
    a.channel = false;
    isSkill = true;
  } else if (
    ab.skill.mp > 0 &&
    a.mp >= ab.skill.mp &&
    !status(a, "Skill Seal") &&
    !(
      ab.skill.mode === "summon" &&
      b.actors.filter((x) => x.owner === a.id && live(x)).length >=
        (a.side === "player" ? 1 : 2)
    ) &&
    !(
      ["Walking Rotcap", "Pale Bone Mender"].includes(a.name) &&
      allies(b, a).every((x) => x.hp === x.stats.HP)
    )
  ) {
    skill = { ...ab.skill };
    isSkill = true;
    if (skill.channel) {
      a.mp -= skill.mp;
      a.channel = true;
      b.action = action(a, b, skill, true, [], 1500);
      b.phase = "end";
      b.next = b.time + 1500;
      log(b, a.name + " channels " + skill.name + ".");
      if (a.kind === "character") b.casts++;
      return;
    }
  } else skill = basic(a);
  if (a.name === "The Flayed Castellan" && isSkill) {
    skill.targets = integer(s.rng.combat, 2, 3);
    skill.statusRaw = integer(s.rng.combat, 38, 45);
  }
  const ts = targets(s, b, a, skill),
    support =
      skill.mode === "summon" || skill.shieldHP || skill.status === "Taunt";
  if (!ts.length && !support) {
    b.phase = "end";
    b.action = action(a, b, skill, false, [], 1500);
    b.next = b.time + 1500;
    log(b, a.name + " has no reachable target.");
    return;
  }
  if (isSkill) {
    if (!ab.skill.channel) a.mp -= skill.mp;
    if (a.kind === "character") b.casts++;
  }
  if (a.name === "The Ossuary Sovereign" && isSkill) {
    skill.coef *= 1 + 0.08 * a.debt;
    a.debt = 0;
  }
  const duration = isSkill ? 2000 : 1500,
    p =
      (skill.pierce ?? 0) +
      (cycle(a) && ab.cycleType === "pierce" ? (ab.cycleValue ?? 0) : 0) +
      mod(a, "Pierce"),
    pierce = Math.min(
      0.5,
      1 - (1 - Math.min(0.5, p)) * (1 - mod(a, "Penetration")),
    );
  b.action = action(a, b, skill, isSkill, ts, duration, pierce);
  b.phase = "action";
  b.next = b.action.nextHit;
  log(b, a.name + " · " + skill.name);
}
function healingReaction(b: Battle, a: Actor, t: Actor, hp: number): boolean {
  let healed = false;
  if (live(a)) {
    const ls =
      ((cycle(a) && a.abilities.cycleType === "lifesteal"
        ? a.abilities.cycleValue
        : a.abilities.lifesteal) ?? 0) + mod(a, "Lifesteal");
    if (hp && ls > 0)
      healed = heal(b, a, a, hp * ls, false) > 0 && a.kind === "character";
  }
  if (live(t) && hp) {
    const react =
      cycle(t) && t.abilities.cycleType === "reactive"
        ? t.abilities.cycleValue
        : t.abilities.reactive;
    if (react)
      healed =
        (heal(b, t, t, hp * react, false) > 0 && t.kind === "character") ||
        healed;
  }
  return healed;
}
function directBatch(s: GameState, b: Battle): void {
  const ac = b.action!,
    a = b.actors.find((x) => x.id === ac.actor)!;
  if (!live(a)) {
    endTurn(s, b, a);
    return;
  }
  const sk = ac.skill;
  let healing = false;
  if (sk.mode === "summon") summon(b, a);
  if (sk.mode === "heal" || sk.mode === "shield")
    for (const id of ac.targets) {
      const t = b.actors.find((x) => x.id === id)!;
      const v = combatStat(b, a, sk.stat) * sk.coef;
      if (sk.mode === "heal")
        healing =
          (heal(b, a, t, v + t.stats.HP * (a.abilities.healHP ?? 0)) > 0 &&
            t.kind === "character") ||
          healing;
      else shield(b, a, t, v);
    }
  const reactions: { target: Actor; hp: number; damage: number }[] = [];
  if (sk.mode === "damage")
    for (const id of ac.targets) {
      const t = b.actors.find((x) => x.id === id)!;
      if (!live(t)) continue;
      const acc =
          a.stats.ACC *
          (1 - (status(a, "Darkness")?.raw ?? 0) * (1 - mod(a, "Dawn"))),
        hit = clamp(acc / (acc + t.stats.EVA) || 0, 0.1, 1);
      if (!chance(s.rng.combat, hit)) {
        log(b, a.name + " misses " + t.name + ".");
        continue;
      }
      let crit = chance(
          s.rng.combat,
          Math.min(0.5, a.stats.CRIT / (a.stats.CRIT + 100)),
        ),
        mult = 1.5;
      if (a.critReady) {
        crit = true;
        mult = a.abilities.cycleValue ?? 1.5;
        a.critReady = false;
      }
      if (crit && !ac.crit) {
        ac.crit = true;
        if (a.kind === "character") b.critActions++;
      }
      if (ac.block[t.id] === undefined)
        ac.block[t.id] =
          sk.element === "Physical" &&
          !!t.abilities.block &&
          chance(s.rng.combat, t.abilities.block);
      const d = reduce(
          b,
          a,
          t,
          combatStat(b, a, sk.stat) * sk.coef * (crit ? mult : 1),
          sk.element,
          ac.pierce,
          false,
          0,
          ac.block[t.id] ? (t.abilities.blockReduction ?? 0) : 0,
        ),
        loss = absorb(t, d, mod(a, "ShieldBreak"));
      reactions.push({ target: t, hp: loss.hp, damage: loss.hp + loss.shield });
      visual(b, a, t, -loss.hp);
      log(b, (crit ? "CRIT · " : "") + a.name + " → " + t.name + " " + d + ".");
      death(b, t);

      if (
        live(t) &&
        ac.isSkill &&
        sk.status &&
        !ac.statusChecked.includes(t.id) &&
        ac.targets.indexOf(t.id) < (sk.statusTargets ?? 99) &&
        sk.status !== "Taunt"
      ) {
        ac.statusChecked.push(t.id);
        let raw = sk.statusRaw ?? 0;
        if (["Poison", "Trap"].includes(sk.status))
          raw *= combatStat(b, a, sk.stat);
        if (sk.status === "Doom Mark") raw *= combatStat(b, a, "MATK");
        if (sk.status === "Poison")
          raw *=
            1 + Math.min(0.5, mod(a, "PoisonDamage") + mod(a, "DOTDamage"));
        if (["Burn", "Bleeding"].includes(sk.status))
          raw *= 1 + mod(a, "DOTDamage");
        applyStatus(s, b, a, t, sk.status, raw);
        if (a.name === "Venom Apostle") applyStatus(s, b, a, t, "Wither");
      }
    }
  for (const { target: t, hp, damage } of reactions) {
    healing = healingReaction(b, a, t, hp) || healing;
    if (live(t) && live(a) && t.abilities.reflect && hp)
      rawHit(b, t, a, hp * t.abilities.reflect, "Shadow");
    if (live(t) && live(a) && damage && !ac.counterChecked.includes(t.id)) {
      ac.counterChecked.push(t.id);
      if (
        !status(t, "Stun") &&
        (t.ranged || !a.flying) &&
        (t.counterReady || chance(s.rng.combat, t.abilities.counter ?? 0))
      ) {
        ac.counterQueue.push({
          source: t.id,
          target: a.id,
          coef: t.counterReady || t.abilities.counterCoef || 0,
        });
        t.counterReady = 0;
      }
    }
  }
  ledger(b, healing);
  if (ac.hit === 0 && live(a) && ac.isSkill) {
    if (sk.shieldHP) shield(b, a, a, a.stats.HP * sk.shieldHP);
    if (sk.status === "Taunt") applyStatus(s, b, a, a, "Taunt", sk.statusRaw);
    if (a.kind === "character" && a.abilities.counter)
      a.counterReady = Math.max(a.counterReady, a.abilities.counterCoef ?? 0);
    if (a.name === "The Abyssal Regent") shield(b, a, a, a.stats.HP * 0.05);
  }
  ac.hit++;
  if (ac.counterQueue.length && !outcome(b)) {
    ac.phase = "counter";
    b.next = b.time + 500;
  } else finishHit(s, b, a);
}
function finishHit(s: GameState, b: Battle, a: Actor): void {
  const ac = b.action!;
  if (outcome(b)) return;
  if (!live(a) || ac.hit >= ac.skill.hits) {
    if (live(a) && ac.skill.mode === "damage")
      for (const id of ac.counterChecked) {
        const t = b.actors.find((x) => x.id === id)!;
        if (!live(t)) continue;
        if (
          mod(a, "DefenseBreak") &&
          chance(s.rng.combat, Math.min(0.5, mod(a, "DefenseBreak")))
        )
          applyStatus(s, b, a, t, "Defense Break");
        if (
          t.channel &&
          chance(
            s.rng.combat,
            clamp(
              0.25 +
                mod(a, "InterruptPower") -
                (t.abilities.skill.channel ?? 0) / 100,
              0,
              0.75,
            ),
          )
        ) {
          t.channel = false;
          log(b, t.name + " is interrupted.");
        }
      }
    if (live(a) && !ac.isSkill && ac.targets.length && a.kind !== "unit")
      a.mp = Math.min(a.abilities.skill.mp, a.mp + 1);
    endTurn(s, b, a);
    return;
  }
  ac.phase = "hit";
  ac.nextHit =
    ac.start + Math.floor((ac.duration * (ac.hit + 1)) / ac.skill.hits);
  b.next = ac.nextHit;
}
export function roundQueue(b: Battle): string[] {
  const side = (s: string) =>
      b.actors
        .filter((a) => a.side === s && live(a) && a.spawnRound < b.round)
        .sort(
          (a, b) =>
            Number(!!status(a, "Slow")) - Number(!!status(b, "Slow")) ||
            a.position - b.position,
        ),
    p = side("player"),
    e = side("enemy"),
    ids: string[] = [];
  for (let i = 0; i < Math.max(p.length, e.length); i++) {
    if (p[i]) ids.push(p[i].id);
    if (e[i]) ids.push(e[i].id);
  }
  return ids;
}
export function nextEventTime(b: Battle): number {
  let t = b.next;
  for (const a of b.actors.filter(live))
    for (const st of a.statuses)
      if (["Burn", "Bleeding"].includes(st.name)) t = Math.min(t, st.nextTick);
  return t;
}
export function stepBattle(s: GameState): void {
  const b = s.battle;
  if (!b || b.result) return;
  const t = nextEventTime(b);
  b.time = t;
  if (b.next === t) {
    if (b.phase === "opening") {
      for (const a of b.actors
        .filter(
          (x) => x.kind === "character" && live(x) && mod(x, "Opening") > 0,
        )
        .sort((x, y) => x.position - y.position)) {
        const target = b.actors.find((x) => x.side === "enemy" && live(x));
        if (target) rawHit(b, a, target, mod(a, "Opening"), "Arcane");
      }
      b.openingDone = true;
      if (outcome(b)) return;
      if (b.kind === "squirrel") {
        b.result = "escape";
        log(b, "Pale Squirrel escapes.");
        return;
      }
      for (const a of b.actors)
        if (a.name === "The Abyssal Regent") shield(b, a, a, a.stats.HP * 0.05);
      b.phase = "turn";
      b.queue = roundQueue(b);
      b.next = t;
    } else if (b.phase === "turn") startTurn(s, b);
    else if (b.phase === "end") {
      const a = b.actors.find((a) => a.id === b.action?.actor)!;
      endTurn(s, b, a, !!status(a, "Stun"));
    } else if (b.action?.phase === "counter") {
      const ac = b.action,
        c = ac.counterQueue.shift()!,
        a = b.actors.find((x) => x.id === c.source)!,
        target = b.actors.find((x) => x.id === c.target)!;
      if (live(a) && live(target) && !status(a, "Stun")) {
        const acc =
          a.stats.ACC *
          (1 - (status(a, "Darkness")?.raw ?? 0) * (1 - mod(a, "Dawn")));
        if (
          chance(
            s.rng.combat,
            clamp(acc / (acc + target.stats.EVA) || 0, 0.1, 1),
          )
        ) {
          const crit = chance(
              s.rng.combat,
              Math.min(0.5, a.stats.CRIT / (a.stats.CRIT + 100)),
            ),
            blocked =
              !!target.abilities.block &&
              chance(s.rng.combat, target.abilities.block),
            d = reduce(
              b,
              a,
              target,
              combatStat(b, a, "ATK") * c.coef * (crit ? 1.5 : 1),
              "Physical",
              0,
              false,
              0,
              blocked ? (target.abilities.blockReduction ?? 0) : 0,
            ),
            hp = absorb(target, d, mod(a, "ShieldBreak")).hp;
          visual(b, a, target, -hp);
          death(b, target);
          ledger(b, healingReaction(b, a, target, hp));
          log(b, a.name + " counters " + target.name + " for " + d + ".");
        }
      }
      ac.start += 500;
      if (ac.counterQueue.length) b.next = t + 500;
      else finishHit(s, b, b.actors.find((x) => x.id === ac.actor)!);
    } else directBatch(s, b);
  }
  if (outcome(b)) return;
  for (const a of b.actors.filter(live))
    for (const st of [...a.statuses])
      if (["Burn", "Bleeding"].includes(st.name) && st.nextTick === t) {
        statusDamage(b, a, st);
        st.nextTick += 1000;
        st.remaining--;
        if (!st.remaining) a.statuses = a.statuses.filter((x) => x !== st);
      }
  if (outcome(b)) {
    delete b.pendingEnd;
    return;
  }
  const pending = b.pendingEnd;
  if (pending) {
    delete b.pendingEnd;
    const actor = b.actors.find((a) => a.id === pending.actor)!;
    finishTurn(s, b, actor, pending.stunned);
  }
}
