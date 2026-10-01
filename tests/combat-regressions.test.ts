import test from "node:test";
import assert from "node:assert/strict";
import { newGame } from "../packages/core/game";
import { startBattle } from "../packages/world";
import { stepBattle, applyStatus, roundQueue } from "../packages/combat";
import { actorFromCharacter, createCharacter } from "../packages/characters";
import { classAbilities } from "../packages/content/abilities";
import type { Actor, GameState, Skill } from "../packages/core/types";
function fixture() {
  const s = newGame(11n, {
    gameUtc: 1780000000000,
    elapsed: 0,
    boot: "test",
    warning: false,
  });
  startBattle(s, 1, "normal", s.clock.gameUtc);
  s.battle!.actors = s.battle!.actors.slice(0, 2);
  for (const a of s.battle!.actors) {
    a.stats.HP = a.hp = 10000;
    a.stats.ATK = 100;
    a.stats.MATK = 100;
    a.stats.DEF = 0;
    a.stats.ACC = 100;
    a.stats.EVA = 0;
    a.stats.CRIT = 0;
    a.abilities = {
      bonus: {},
      skill: {
        name: "test",
        mp: 3,
        coef: 1,
        stat: "ATK",
        targets: 1,
        hits: 1,
        mode: "damage",
        element: "Physical",
      },
    };
  }
  return s;
}
function queueAction(s: GameState, a: Actor, skill: Skill, isSkill = false) {
  const b = s.battle!,
    targets = b.actors.filter((x) => x.side !== a.side).slice(0, skill.targets);
  b.phase = "action";
  b.time = 0;
  b.next = 1000;
  b.queue = [a.id, ...targets.map((x) => x.id)];
  b.turn = 0;
  b.action = {
    actor: a.id,
    targets: targets.map((x) => x.id),
    skill,
    isSkill,
    start: 0,
    nextHit: 1000,
    hit: 0,
    duration: 1000,
    counterChecked: [],
    statusChecked: [],
    block: {},
    crit: false,
    pierce: 0,
    counterQueue: [],
    phase: "hit",
  };
}
test("R67 timestamp: timed bleeding precedes turn-end poison", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  a.hp = 1;
  t.hp = 1;
  a.turns = 1;
  a.statuses = [
    {
      name: "Poison",
      remaining: 3,
      raw: 2,
      appliedTurn: 0,
      nextTick: 1000,
      source: t.id,
    },
  ];
  t.statuses = [
    {
      name: "Bleeding",
      remaining: 6,
      raw: 2,
      appliedTurn: 0,
      nextTick: 1000,
      source: a.id,
    },
  ];
  b.phase = "end";
  b.next = 1000;
  queueAction(s, a, { ...a.abilities.skill, targets: 0 });
  b.phase = "end";
  stepBattle(s);
  assert.equal(b.result, "win");
  assert.equal(a.hp, 1);
  assert.equal(t.hp, 0);
});
test("R67 simultaneous timed DoTs still result in mutual-death loss", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  for (const x of [a, t]) {
    x.hp = 1;
    x.statuses = [
      {
        name: "Bleeding",
        remaining: 6,
        raw: 2,
        appliedTurn: 0,
        nextTick: 500,
        source: x === a ? t.id : a.id,
      },
    ];
  }
  stepBattle(s);
  assert.equal(b.result, "loss");
  assert.equal(a.hp, 0);
  assert.equal(t.hp, 0);
});
test("R67 direct lethal hit takes priority over same-time timed DoT", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  a.hp = 1;
  t.hp = 1;
  a.statuses = [
    {
      name: "Bleeding",
      remaining: 6,
      raw: 2,
      appliedTurn: 0,
      nextTick: 1000,
      source: t.id,
    },
  ];
  queueAction(s, a, a.abilities.skill);
  stepBattle(s);
  assert.equal(b.result, "win");
  assert.equal(a.hp, 1);
});
test("R67 Valkyrie skill cannot downgrade stronger periodic counter charge", () => {
  const s = fixture(),
    b = s.battle!,
    a = b.actors[0];
  a.abilities = classAbilities("Valkyrie");
  a.counterReady = 1.4;
  a.turns = 4;
  queueAction(s, a, a.abilities.skill, true);
  stepBattle(s);
  assert.equal(a.counterReady, 1.4);
});
test("enemy probabilistic counter skill does not grant guaranteed charge", () => {
  const s = fixture(),
    a = s.battle!.actors[1];
  a.abilities.counter = 0.3;
  a.abilities.counterCoef = 0.8;
  queueAction(s, a, a.abilities.skill, true);
  stepBattle(s);
  assert.equal(a.counterReady, 0);
});
test("reactive periodic bonus is not active before the first turn", () => {
  const s = fixture(),
    [a, t] = s.battle!.actors;
  t.abilities.reactive = 0.1;
  t.abilities.cycle = 3;
  t.abilities.cycleType = "reactive";
  t.abilities.cycleValue = 0.3;
  t.turns = 0;
  queueAction(s, a, a.abilities.skill);
  stepBattle(s);
  assert.equal(t.hp, 9910);
});
test("Slow only rearranges unfinished slots of its own side", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  const p2 = { ...structuredClone(a), id: "p2", position: 1 },
    p3 = { ...structuredClone(a), id: "p3", position: 2 },
    e2 = { ...structuredClone(t), id: "e2", position: 1 };
  b.actors.push(p2, p3, e2);
  b.queue = roundQueue(b);
  b.turn = 0;
  assert.deepEqual(b.queue, [a.id, t.id, "p2", "e2", "p3"]);
  applyStatus(s, b, t, p2, "Slow");
  assert.deepEqual(b.queue, [a.id, t.id, "p3", "e2", "p2"]);
});
test("equal-power refreshed Trap records the new source level", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  const other = { ...structuredClone(a), id: "new-source", level: 75 };
  b.actors.push(other);
  applyStatus(s, b, a, t, "Trap", 100);
  applyStatus(s, b, other, t, "Trap", 100);
  assert.equal(t.statuses[0].source, other.id);
  assert.equal(t.statuses[0].remaining, 1);
});
test("Frenzy triggers when timed DoT crosses the HP threshold", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  t.hp = 3001;
  t.abilities.frenzy = 0.2;
  t.abilities.frenzyThreshold = 0.3;
  t.statuses = [
    {
      name: "Bleeding",
      remaining: 6,
      raw: 2,
      appliedTurn: 0,
      nextTick: 500,
      source: a.id,
    },
  ];
  stepBattle(s);
  assert.equal(t.hp, 2999);
  assert.equal(t.frenzied, true);
});
test("Stun skips periodic reactive activation on its cycle turn", () => {
  const s = fixture(),
    b = s.battle!,
    [a, t] = b.actors;
  t.abilities.reactive = 0.1;
  t.abilities.cycle = 3;
  t.abilities.cycleType = "reactive";
  t.abilities.cycleValue = 0.3;
  t.turns = 2;
  t.statuses = [
    {
      name: "Stun",
      raw: 0,
      remaining: 2,
      source: a.id,
      appliedTurn: 2,
      nextTick: 1000,
    },
  ];
  b.phase = "turn";
  b.queue = [t.id, a.id];
  b.turn = 0;
  b.next = 0;
  stepBattle(s);
  assert.equal(t.turns, 3);
  assert.equal(t.cycleReady, false);
  t.statuses = [];
  queueAction(s, a, a.abilities.skill);
  stepBattle(s);
  assert.equal(t.hp, 9910);
});
