import { content } from "./index";
import type { Abilities, Skill, EnemyDefinition } from "../core/types";
const attack = (
  name: string,
  mp: number,
  coef: number,
  stat: "ATK" | "MATK" = "ATK",
  targets = 1,
  hits = 1,
): Skill => ({
  name,
  mp,
  coef,
  stat,
  targets,
  hits,
  mode: "damage",
  element: stat === "ATK" ? "Physical" : "Arcane",
});
export function classAbilities(name: string): Abilities {
  const a: Abilities = { skill: attack("Heavy Strike", 3, 1.8), bonus: {} };
  const bases: Record<string, Abilities> = {
    Warrior: a,
    Mage: { skill: attack("Arcane Burst", 3, 0.9, "MATK", 3), bonus: {} },
    Rogue: { skill: attack("Twin Strike", 3, 1, "ATK", 1, 2), bonus: {} },
    Fighter: {
      skill: { ...attack("Armor Break", 3, 2), pierce: 0.2 },
      bonus: { ATK: 0.1 },
    },
    Knight: {
      skill: { ...attack("Iron Guard", 3, 1.5), shieldHP: 0.15 },
      bonus: { HP: 0.05, DEF: 0.05 },
    },
    Wizard: {
      skill: attack("Mana Storm", 3, 1.1, "MATK", 3),
      bonus: { MATK: 0.1 },
    },
    Cleric: {
      skill: { ...attack("Restoring Light", 3, 1.8, "MATK"), mode: "heal" },
      bonus: { HP: 0.05, MATK: 0.05 },
    },
    Assassin: {
      skill: attack("Shadow Strike", 3, 2.2),
      bonus: { ATK: 0.05, CRIT: 0.05 },
    },
    Sniper: {
      skill: attack("Piercing Shot", 3, 1.5, "ATK", 2),
      bonus: { ATK: 0.1 },
    },
  };
  if (bases[name]) return structuredClone(bases[name]);
  const p = content.classPaths.findIndex((x) => x.slice(2).includes(name));
  if (p < 0) throw Error("Unknown class " + name);
  const t = content.classPaths[p].indexOf(name) - 2;
  const labels = [
    ["Bloodblade", "Bloodrage Slash", "Ruinous Cleave"],
    ["Steel Riposte", "Slaughtering Riposte", "Vengeful Descent"],
    ["Holy Bulwark", "Unyielding Fortress", "Eternal Bastion"],
    ["Challenge", "Overwhelming Warcry", "Dread Dominion"],
    ["Elemental Storm", "Arcane Tempest", "Chaos Convergence"],
    ["Summon Dark Unit", "Necromantic Summon", "Abyssal Reanimation"],
    ["Saving Light", "Eternal Light", "Soul Benediction"],
    ["Purifying Barrier", "Sacred Ward", "Sanctified Ward"],
    ["Mist Dance", "Soul Dance", "Spectral Waltz"],
    ["Night Slash", "Venomshadow Slash", "Void Harvest"],
    ["Armor-Piercing Volley", "Rift Volley", "Soulpiercer Volley"],
    ["Snare Volley", "Deathtrap Barrage", "Tempest Barrage"],
  ];
  a.skill = attack(
    labels[p][t],
    p === 3 || p === 4 || p === 5 || p === 7 || p >= 9 ? 4 : 3,
    1,
    p >= 4 && p <= 7 ? "MATK" : "ATK",
  );
  switch (p) {
    case 0:
      a.skill.coef = [2.4, 2.8, 3.3][t];
      a.lifesteal = [0.1, 0.15, 0.2][t];
      a.cycle = 3;
      a.cycleType = "lifesteal";
      a.cycleValue = [0.2, 0.3, 0.35][t];
      break;
    case 1:
      a.skill.coef = [2, 2.4, 2.8][t];
      a.counter = 0.5;
      a.counterCoef = [0.8, 1, 1.2][t];
      a.cycle = 4;
      a.cycleType = "counter";
      a.cycleValue = [0.8, 1.2, 1.4][t];
      break;
    case 2:
      a.skill.coef = [1.8, 2, 2.3][t];
      a.skill.shieldHP = [0.25, 0.3, 0.35][t];
      a.dr = [0.15, 0.2, 0.25][t];
      a.cycle = 5;
      a.cycleType = "shield";
      a.cycleValue = [0.1, 0.15, 0.2][t];
      break;
    case 3:
      a.skill.coef = [1.7, 2, 2.4][t];
      a.skill.status = "Taunt";
      a.skill.statusRaw = [0.65, 0.7, 0.75][t];
      a.bonus = { HP: [0.1, 0.15, 0.2][t], DEF: [0.1, 0.15, 0.2][t] };
      a.reactive = [0.1, 0.15, 0.2][t];
      a.cycle = 3;
      a.cycleType = "reactive";
      a.cycleValue = [0.2, 0.25, 0.3][t];
      break;
    case 4:
      a.skill.coef = [1.8, 2.1, 2.5][t];
      a.skill.targets = [3, 4, 4][t];
      a.bonus = { MATK: [0.1, 0.15, 0.2][t] };
      a.cycle = 3;
      a.cycleType = "pierce";
      a.cycleValue = [0.2, 0.25, 0.3][t];
      break;
    case 5:
      a.skill.mode = "summon";
      a.summon = t;
      a.cycle = 4;
      a.cycleType = "unitHeal";
      a.cycleValue = [0.15, 0.2, 0.25][t];
      break;
    case 6:
      a.skill.mode = "heal";
      a.skill.coef = [1.2, 1.5, 1.8][t];
      a.skill.targets = 4;
      a.healHP = [0.1, 0.15, 0.18][t];
      a.cycle = 3;
      a.cycleType = "heal";
      a.cycleValue = [0.6, 0.8, 1][t];
      break;
    case 7:
      a.skill.mode = "shield";
      a.skill.coef = [0.8, 1.1, 1.4][t];
      a.skill.targets = 4;
      a.bonus = { DEF: [0.05, 0.1, 0.15][t] };
      a.cycle = 4;
      a.cycleType = "cleanse";
      a.cycleValue = t + 1;
      break;
    case 8:
      a.skill.coef = [1.3, 1.5, 1.75][t];
      a.skill.hits = 2;
      a.bonus = { CRIT: [0.15, 0.25, 0.3][t], EVA: [0.15, 0.25, 0.3][t] };
      a.cycle = 3;
      a.cycleType = "crit";
      a.cycleValue = [1.5, 1.75, 2][t];
      break;
    case 9:
      a.skill.coef = [1.5, 1.8, 2.3][t];
      a.skill.element = "Shadow";
      a.skill.status = "Poison";
      a.skill.statusRaw = [0.1, 0.12, 0.15][t];
      a.bonus = { ATK: [0.1, 0.15, 0.2][t] };
      a.cycle = 4;
      a.cycleType = "pierce";
      a.cycleValue = [0.2, 0.25, 0.3][t];
      break;
    case 10:
      a.skill.coef = [0.9, 1.1, 1.3][t];
      a.skill.hits = 3;
      a.skill.pierce = [0.2, 0.25, 0.3][t];
      a.bonus = { ATK: [0.1, 0.15, 0.2][t], CRIT: [0.1, 0.15, 0.2][t] };
      a.cycle = 3;
      a.cycleType = "pierce";
      a.cycleValue = [0.1, 0.15, 0.15][t];
      break;
    case 11:
      a.skill.coef = [1.2, 1.5, 1.8][t];
      a.skill.targets = [3, 4, 4][t];
      a.skill.status = "Trap";
      a.skill.statusRaw = [0.6, 0.8, 1][t];
      a.bonus = { ATK: [0.05, 0.1, 0.15][t], CRIT: [0.05, 0.1, 0.15][t] };
      a.cycle = 4;
      a.cycleType = "trap";
      a.cycleValue = t + 1;
      break;
  }
  return a;
}
export function enemyAbilities(e: EnemyDefinition): Abilities {
  const d = e.description.replace(/\s/g, "");
  const mp = Number(d.match(/(\d)MP/)?.[1] ?? 0);
  const power = d.match(/(\d+)%(MATK|ATK)/);
  const stat = (power?.[2] ?? (e.stats.ATK ? "ATK" : "MATK")) as "ATK" | "MATK";
  const a: Abilities = {
    skill: attack(
      e.name + " skill",
      mp,
      Number(power?.[1] ?? 100) / 100,
      stat,
      Number(d.match(/tốiđa(\d)/)?.[1] ?? 1),
      Number(d.match(/(\d)(?:phát)?×\d+%/)?.[1] ?? 1),
    ),
    bonus: {},
  };
  const n = e.name;
  const st = (name: string, raw = 0, targets = 99) => {
    a.skill.status = name;
    a.skill.statusRaw = raw;
    a.skill.statusTargets = targets;
  };
  if (/Shield|khiên/.test(d) && !/ATK/.test(d)) {
    a.skill.mode = "shield";
    a.skill.coef = Number(d.match(/(\d+)%MATK/)?.[1] ?? 100) / 100;
  }
  if (["Walking Rotcap", "Tormented Crystal", "Pale Bone Mender"].includes(n))
    a.skill = {
      ...attack(
        "Restoring Light",
        n === "Walking Rotcap" ? 3 : 4,
        n === "Pale Bone Mender" ? 1.6 : 1.5,
        "MATK",
      ),
      mode: "heal",
    };
  if (n === "Blood Mosquito") a.lifesteal = 0.2;
  if (["Giant Leech", "Corpse Ghoul", "Venomless Leech"].includes(n))
    a.lifesteal = 0.15;
  if (n === "Mud Crocodile") a.group = 0.05;
  if (n === "Abyssal Legionnaire") a.group = 0.1;
  if (n === "Ironshield Skeleton") {
    a.block = 0.15;
    a.blockReduction = 0.2;
    a.skill.shieldHP = 0.2;
  }
  if (n === "Orichalcum Bulwark") {
    a.block = 0.25;
    a.blockReduction = 0.3;
    a.skill.shieldHP = 0.12;
  }
  if (n === "Grave Knight") {
    a.frenzy = 0.1;
    a.frenzyThreshold = 0.3;
  }
  if (n === "Eclipse Ravager") {
    a.frenzy = 0.2;
    a.frenzyThreshold = 0.35;
  }
  if (
    ["Rustblade Executioner", "Penitent Knight", "Oathbreaker Knight"].includes(
      n,
    )
  ) {
    a.counter = 0.3;
    a.counterCoef = 0.8;
  }
  if (n === "Mourning Witch") a.reflect = 0.05;
  if (n === "Mirror Wraith") {
    a.reflect = 0.1;
    a.skill.element = "Shadow";
  }
  if (["Gallows Warden", "Darkiron Golem"].includes(n)) a.skill.shieldHP = 0.15;
  if (n === "Adamant Boneguard") a.skill.shieldHP = 0.12;
  if (n === "Floating Demon Eye") st("Stun");
  if (n === "Marsh Viper") st("Poison", 0.1);
  if (n === "Skeleton Miner") st("Burn", 8);
  if (["Gallows Revenant", "Oreweaver Spider"].includes(n)) st("Weaken");
  if (["Mourning Witch", "Bloodbound Acolyte", "Ossuary Wraith"].includes(n))
    st("Wither");
  if (["Chapel Gargoyle", "Hexfire Magister", "Skull Hexer"].includes(n))
    st(
      "Darkness",
      0,
      n === "Hexfire Magister" ? 1 : n === "Skull Hexer" ? 2 : 99,
    );
  if (n === "Crimson Cantor") {
    a.skill = attack("Hushed Hymn", 4, 0.9, "MATK", 2);
    a.skill.channel = 10;
    st("Skill Seal", 0, 1);
  }
  if (n === "Null Chantor") {
    a.skill = attack("Null Verse", 5, 1.3, "MATK", 3);
    a.skill.channel = 20;
    st("Skill Seal", 0, 1);
  }
  if (n === "Cinder Maw") {
    a.skill.element = "Fire";
    st("Burn", 20);
  }
  if (n === "Venom Apostle") st("Poison", 0.12);
  if (n === "Citadel Halberdier") st("Bleeding", 10);
  if (n === "Bloodglass Archer") st("Bleeding", 8);
  if (n === "Bone Reaver") st("Bleeding", 18);
  if (n === "Razorwire Trapper") st("Trap", 1.3);
  if (n === "Spine Stalker") st("Trap", 1.4);
  if (n === "Cursed Reliquary") a.cleanseCycle = 5;
  if (n === "Void Relic Keeper") {
    a.cleanseCycle = 4;
    a.skill = { ...attack("Relic Eclipse", 5, 1.6, "MATK", 3), mode: "shield" };
  }
  if (n === "Rift Broodmother")
    a.skill = { ...attack("Brood Call", 5, 1, "MATK"), mode: "summon" };
  if (e.kind === "boss") {
    const i = e.map - 1;
    a.skill = attack(
      [
        "Alpha Howl",
        "Crushing Roar",
        "Venom Tide",
        "Tombquake",
        "Cave-In",
        "Mass Hanging",
        "Crimson Benediction",
        "Citadel Rupture",
        "Reaper’s Due",
        "Cataclysm",
      ][i],
      [3, 4, 4, 4, 5, 4, 5, 5, 5, 6][i],
      [0.8, 1.1, 0.9, 1.1, 1.2, 1.2, 1.1, 1.2, 1.1, 1.4][i],
      [3, 7, 8, 9, 10].includes(e.map) ? "MATK" : "ATK",
      [1, 5, 7, 9, 10].includes(e.map) ? 4 : 3,
    );
    if (e.map === 2) {
      a.physicalDR = 0.15;
      st("Stun", 0, 1);
    }
    if (e.map === 3) st("Poison", 0.1);
    if ([4, 5, 6].includes(e.map)) {
      a.cycle = 5;
      a.cycleType = "shield";
      a.cycleValue = e.map === 4 ? 0.08 : e.map === 5 ? 0.06 : 0.05;
    }
    if (e.map === 6) {
      st("Wither");
      a.stunRes = 0.2;
    }
    if (e.map === 7) {
      st("Darkness", 0, 2);
      a.cycle = 5;
      a.cycleType = "alternating";
    }
    if (e.map === 8) {
      st("Trap", 1);
      a.cycle = 5;
      a.cycleType = "shield";
      a.cycleValue = 0.04;
    }
    if (e.map === 10) {
      a.skill.channel = 35;
      a.skill.element = "Shadow";
      a.stunImmune = true;
      a.frenzy = 0.15;
      a.frenzyThreshold = 0.3;
    }
  }
  if (e.kind === "hidden") {
    a.skill = attack("Nameless Sentence", 4, 1.6);
    st("Doom Mark", 0.7);
    a.counter = 0.5;
    a.counterCoef = 0.8;
    a.ward = 0.25;
  }
  if (e.kind === "mini") {
    a.skill = attack("Crimson Laceration", 4, 0.8, "ATK", 3);
    st("Bleeding", 38);
  }
  return a;
}
