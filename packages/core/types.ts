export type BaseClass = "Warrior" | "Mage" | "Rogue";
export type Stat = "HP" | "ATK" | "MATK" | "DEF" | "ACC" | "CRIT" | "EVA";
export type Stats = Record<Stat, number>;
export type Slot = "Weapon" | "Hands" | "Feet" | "Head" | "Ring" | "Necklace";
export type Stream =
  | "combat"
  | "encounter"
  | "loot"
  | "craft"
  | "summon"
  | "enhance"
  | "daily";
export interface RandomState {
  state: string;
  inc: string;
}
export interface Character {
  id: string;
  name?: string;
  gender?: "male" | "female";
  baseClass: BaseClass;
  className: string;
  level: number;
  exp: number;
  classLevel?: number;
  classExp?: number;
  traits: string[];
  gear: Partial<Record<Slot, string>>;
  party: number | null;
}
export interface Equipment {
  id: string;
  templateId: string;
  rarity: number;
  enhancement: number;
  affixes: Record<string, number>;
  owner: string | null;
}
export interface Status {
  name: string;
  remaining: number;
  raw: number;
  appliedTurn: number;
  nextTick: number;
  source: string;
}
export interface Skill {
  name: string;
  mp: number;
  coef: number;
  stat: "ATK" | "MATK";
  targets: number;
  hits: number;
  mode: "damage" | "heal" | "shield" | "summon";
  element: string;
  pierce?: number;
  shieldHP?: number;
  status?: string;
  statusRaw?: number;
  statusTargets?: number;
  channel?: number;
}
export interface Abilities {
  skill: Skill;
  bonus: Partial<Stats>;
  dr?: number;
  physicalDR?: number;
  counter?: number;
  counterCoef?: number;
  lifesteal?: number;
  reactive?: number;
  cycle?: number;
  cycleType?: string;
  cycleValue?: number;
  healHP?: number;
  summon?: number;
  reflect?: number;
  block?: number;
  blockReduction?: number;
  frenzy?: number;
  frenzyThreshold?: number;
  group?: number;
  cleanseCycle?: number;
  stunRes?: number;
  stunImmune?: boolean;
  ward?: number;
}
export interface Actor {
  cycleReady?: boolean;
  id: string;
  templateId: string;
  name: string;
  side: "player" | "enemy";
  kind: "character" | "enemy" | "unit";
  baseClass?: BaseClass;
  owner?: string;
  position: number;
  level: number;
  stats: Stats;
  hp: number;
  shield: number;
  mp: number;
  turns: number;
  statuses: Status[];
  immune: Record<string, number>;
  abilities: Abilities;
  mods: Record<string, number>;
  flying: boolean;
  ranged: boolean;
  spawnRound: number;
  channel: boolean;
  frenzied: boolean;
  counterReady: number;
  critReady: boolean;
  debt: number;
}
export type BattleKind = "normal" | "boss" | "hidden" | "mini" | "squirrel";
export interface Action {
  actor: string;
  targets: string[];
  skill: Skill;
  isSkill: boolean;
  start: number;
  nextHit: number;
  hit: number;
  duration: number;
  counterChecked: string[];
  statusChecked: string[];
  block: Record<string, boolean>;
  crit: boolean;
  pierce: number;
  counterQueue: { source: string; target: string; coef: number }[];
  phase: "hit" | "counter";
}
export interface Battle {
  presentationUntil?: number;
  visualSequence?: number;
  visualEvents?: { sequence: number; source: string; target: string; value: number; skill: boolean; action: string; at: number }[];
  pendingEnd?: { actor: string; stunned: boolean };
  id: string;
  map: number;
  kind: BattleKind;
  actors: Actor[];
  round: number;
  queue: string[];
  turn: number;
  time: number;
  next: number;
  phase: "opening" | "turn" | "action" | "end";
  action: Action | null;
  result: "win" | "loss" | "escape" | null;
  log: string[];
  kills: string[];
  critActions: number;
  casts: number;
  startedAt: number;
  openingDone: boolean;
}
export interface MapProgress {
  wins: string;
  completed: string;
  streak: string;
  seen: string[];
  kills: Record<string, string>;
  bossUnlocked: boolean;
  bossDefeated: boolean;
}
export interface Daily {
  day: number;
  tier: number;
  tasks: { id: string; progress: number; done: boolean; target?: number }[];
  ruleVersion?: number;
  claimedMilestones?: number[];
  species: string[];
  ticketGranted: boolean;
}
export interface ClockAnchor {
  gameUtc: number;
  elapsed: number;
  boot: string | null;
  warning: boolean;
}
export interface Expedition {
  map: number; partyIds: string[]; battle: Battle | null; farming: number | null; restUntil: number; completedBattle?: Battle;
}
export interface GameState {
  completedBattle?: Battle;
  schemaVersion: 1;
  contentVersion: "R67";
  testResetVersion?: number;
  boostedTestVersion?: number;
  saveId: string;
  revision: number;
  nextId: number;
  gold: string;
  tickets: string;
  rosterCapacity: number;
  capacity: string;
  characters: Character[];
  equipment: Equipment[];
  materials: Record<string, string>;
  pending: Record<string, string>;
  unlockedMap: number;
  maps: MapProgress[];
  hidden: {
    pity: number;
    count: number;
    discovered: boolean;
    defeated: boolean;
  };
  squirrel: boolean;
  miniCleared: boolean;
  chapterCleared: boolean;
  daily: Daily;
  quota: { day: number; wins: number[] };
  rng: Record<Stream, RandomState>;
  clock: ClockAnchor;
  expeditions?: Expedition[];
  battle: Battle | null;
  farming: number | null;
  restUntil: number;
  receipts: string[];
  rewards: string[];
  settings: { music: number; sfx: number };
  idle: { cutoff: number; cursor: number; capped: boolean } | null;
}
export interface EnemyDefinition {
  id: string;
  name: string;
  map: number;
  kind: string;
  level: number;
  stats: Record<string, number>;
  flying: boolean;
  ranged: boolean;
  description: string;
  exp: number;
  gold: number;
  drops: string[];
}
export interface Recipe {
  id: string;
  name: string;
  tier: number;
  baseClass: string;
  slot: string;
  ingredients: { id: string; name: string; quantity: number }[];
  stats: Record<string, number>;
  fixed: string;
  ranged: boolean;
}
export type Command =
  | { type: "start"; map: number; kind: BattleKind; partyIds?: string[] }
  | { type: "leave" }
  | { type: "resume"; map: number }
  | { type: "summon" }
  | { type: "roster-slot" }
  | { type: "bag-slot" }
  | { type: "claim-daily"; milestone: number }
  | { type: "party"; id: string; slot: number | null }
  | { type: "advance"; id: string; className: string }
  | { type: "dismiss"; id: string }
  | { type: "craft"; id: string }
  | { type: "equip"; id: string; character: string }
  | { type: "unequip"; id: string }
  | { type: "enhance"; id: string }
  | { type: "sell"; id: string; quantity: string }
  | { type: "store-pending" }
  | { type: "settings"; music: number; sfx: number };
