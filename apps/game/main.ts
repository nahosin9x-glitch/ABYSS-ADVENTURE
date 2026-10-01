import { skillCards } from "./skills";
import { showArena, clearArena } from "./arena";
import { enemyActor } from "../../packages/combat";
import { art } from "./art";
import { updateAudio } from "./audio";
import "./style.css";
import "./theme-steel.css";
import { newGame, execute, rosterSlotCost } from "../../packages/core/game";
import type { GameState, Command, Equipment } from "../../packages/core/types";
import {
  content,
  recipes,
  enemies,
  recipeById,
  materialById,
} from "../../packages/content";
import {
  characterStats,
  ensureCharacterIdentities,
  nextEvolutionLevel,
  classLevel,
  classLevelLabel,
  choices,
  equipmentStats,
} from "../../packages/characters";
import { used, canCraft, enhancementCost, bagCost, STONE } from "../../packages/economy";
import {
  advanceTo,
  beginIdle,
  stepIdle,
  bossReady,
  gateText,
  miniReady,
  bossRewardMaterials,
  characterMap,
} from "../../packages/world";
import {
  Persistence,
  clockSample,
  advanceClock,
  exportBackup,
  importBackup,
} from "../../packages/platform";
const bootStarted = performance.now();
let bootReady = false;
const bootTimer = setInterval(() => {
  const progress = Math.min(100, Math.floor((performance.now()-bootStarted)/70));
  const fill = document.querySelector<HTMLElement>("#loading-fill");
  const label = document.querySelector<HTMLElement>("#loading-percent");
  if (fill) fill.style.width = `${progress}%`;
  if (label) label.textContent = `${progress}%`;
  if (progress === 100 && bootReady) { clearInterval(bootTimer); document.querySelector("#boot-loading")?.remove(); }
},50);
const root = document.querySelector<HTMLDivElement>("#app")!;
const persistence = new Persistence();
let state: GameState,
  tab = "World",
  error = "",
  busy = false,
  selected = "",
  page = 0,
  inventoryTab: "Equipment" | "Materials" = "Equipment",
  selectedItem = "",
  selectedPartyId = "",
  selectedGearSlot = "",
  selectedUpgradeItem = "",
  selectedGearInfo = "",
  selectedSkill = -1,
  selectedRecipeId = "",
  selectedEvolve = false,
  craftTier = 1,
  journalTab = "Daily",
  journalMap = 1,
  selectedMonster = "",
  battleHidden = true,
  rosterOpen = false,
  pendingStart: { map: number; kind: "normal" | "boss" | "hidden" | "mini" } | null = null,
  selectedExpeditionIds: string[] = [],
  lastBattle: GameState["battle"] = null,
  frozen = false,
  nativeSuspended = false;
let queue = Promise.resolve();
const pending = new Set<string>();
let forgeScene: { id:string; templateId:string; mode:"craft"|"enhance"; finished:boolean; message:string; rarity:number } | null = null;
let summonScene: {name:string; className:string; finished:boolean; id:string; traits:string[]} | null = null;
function summonView() {
  if (!summonScene) return "";
  return `<div class="summon-overlay" data-scene-id="${summonScene.id}" data-finished="${summonScene.finished}"><section class="summon-sheet ${summonScene.finished ? "revealed" : "summoning"}" style="background-image:linear-gradient(#15111d88,#15111dbb),url('${art.menu}')"><h2>${summonScene.finished ? "A new companion" : "Summoning…"}</h2><div class="summon-circle"><img src="${art.character(summonScene.className)}" alt="${esc(summonScene.className)}"></div>${summonScene.finished ? `<h3>${esc(summonScene.name)}</h3><p>${esc(summonScene.className)} · Lv 1</p>${traitLines(summonScene.traits)}<button data-close-summon>Continue</button>` : `<p>Opening the gates…</p>`}</section></div>`;
}
function rosterView() {
  if (!rosterOpen) return "";
  return `<div class="upgrade-overlay"><section class="upgrade-sheet roster-sheet"><button data-close-roster>← Back</button><h2>Roster</h2><p>Companions: ${state.characters.length} / ${state.rosterCapacity}</p><p>Summon tickets: ${state.tickets} / 1 required</p><p>Each Open adds 1 roster slot.</p><div class="roster-open-row">${state.rosterCapacity >= 30 ? `<button disabled>Max 30</button>` : button("Open",{type:"roster-slot"},BigInt(state.gold) < rosterSlotCost(state.rosterCapacity))}${state.rosterCapacity < 30 ? `<span class="${BigInt(state.gold) < rosterSlotCost(state.rosterCapacity) ? "shortage-number" : ""}">${rosterSlotCost(state.rosterCapacity)} Gold</span>` : ""}</div></section></div>`;
}
function returnWorldMenu() {
  tab = "World"; battleHidden = true; selectedPartyId = ""; selectedSkill = -1; selectedGearSlot = ""; selectedUpgradeItem = ""; selectedGearInfo = ""; selectedEvolve = false; rosterOpen = false; pendingStart = null; selectedExpeditionIds = []; summonScene = null;
}
function forgeView() {
  if (!forgeScene) return "";
  const f = forgeScene;
  return `<div class="forge-scene" data-scene-id="${f.id}" data-finished="${f.finished}"><section class="forge-stage" style="background-image:linear-gradient(#13101966,#131019b3),url('${art.forge}')"><h2>${f.mode === "craft" ? "Forging equipment" : "Upgrading equipment"}</h2><div class="forge-work ${f.finished ? "forge-finished" : "forge-running"}" data-rarity="${f.rarity}"><img class="forge-item" src="${art.item(f.templateId)}" alt=""><img class="forge-hammer" src="${art.navigation("Craft")}" alt="Forge"><span class="forge-sparks" aria-hidden="true">✦ · ✧</span></div><strong>${esc(recipeById[f.templateId]?.name ?? "Equipment")}</strong><p>${f.finished ? esc(f.message) : "The forge is working…"}</p>${f.finished ? `<button data-close-forge>Back</button>` : `<div class="forge-progress"><span></span></div>`}</section></div>`;
}
let navigationObserver: ResizeObserver | undefined;
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const costButton = (label: string, value: string, unit: string, cmd: Command, disabled = false) =>
  `<button data-command="${esc(JSON.stringify(cmd))}" ${disabled || (!!state && !!(state.battle || state.farming) && !["summon", "craft", "sell", "roster-slot", "bag-slot"].includes(cmd.type)) ? "disabled" : ""}>${esc(label)} <span class="price-number ${disabled ? "shortage-number" : ""}">${esc(value)}</span> ${esc(unit)}</button>`;
const button = (label: string, cmd: Command, disabled = false) =>
  `<button data-command="${esc(JSON.stringify(cmd))}" ${disabled || (!!state && !!(state.battle || state.farming) && !["leave", "settings", "craft", "sell", "start", "equip", "unequip", "enhance", "advance", "store-pending", "dismiss", "claim-daily", "summon", "roster-slot"].includes(cmd.type)) ? "disabled" : ""}>${esc(label)}</button>`;
function stats(v: Record<string, number>) {
  return Object.entries(v)
    .map(
      ([k, n]) =>
        `${esc(k)} ${["HP","ATK","MATK","DEF","ACC","CRIT","EVA","Opening"].includes(k) ? Number(n.toFixed(2)) : Math.round(n * 100) + "%"}`,
    )
    .join(" · ");
}
function positiveStats(v: Record<string, number>) {
  return Object.entries(v).filter(([, n]) => n > 0)
    .map(([k, n]) => `${esc(k)} +${["HP","ATK","MATK","DEF","ACC","CRIT","EVA","Opening"].includes(k) ? Number(n.toFixed(2)) : Math.round(n * 100) + "%"}`)
    .join(" · ") || "No bonus";
}
function equipmentStatBlocks(e: Equipment) {
  const r = recipeById[e.templateId];
  return `<div class="equipment-base"><small>Base stats · Upgrade +${e.enhancement}</small><p>${positiveStats(equipmentStats(e))}</p></div>${Object.values(e.affixes).some(n => n > 0) || r.fixed ? `<div class="equipment-bonus"><small>Bonus / Affix</small>${Object.values(e.affixes).some(n => n > 0) ? `<p>${positiveStats(e.affixes)}</p>` : ""}${r.fixed ? `<p>${esc(r.fixed)}</p>` : ""}</div>` : ""}`;
}
function gearInfoView(e: Equipment) {
  const r = recipeById[e.templateId];
  return `<div class="upgrade-overlay"><section class="upgrade-sheet" data-rarity="${e.rarity}"><button data-close-info>← Back</button><h3>Equipment info</h3><div class="upgrade-art"><img src="${art.item(e.templateId)}" alt=""></div><strong>${esc(r.name)}${e.enhancement ? ` +${e.enhancement}` : ""}</strong><p>${content.rarities[e.rarity]} · ${r.slot} · Tier ${r.tier}</p>${equipmentStatBlocks(e)}</section></div>`;
}
const traitBonus: Record<string,string> = {
  Vitality: "HP +10%", Fortitude: "DEF +10%", Might: "ATK +10%",
  "Arcane Power": "MATK +10%", "Killing Intent": "CRIT +10",
  Primordial: "HP, ATK, MATK, DEF +7%", Bloodthirst: "Life steal +10%",
  Penetration: "Armor penetration +10%", Resolve: "Control resistance +10%",
  Tenacity: "Damage over time resistance +10%", Warding: "Shield strength +10%",
  Restoration: "Healing +10%",
};
const salePrice = (e: GameState["equipment"][number]) =>
  content.salePrices[recipeById[e.templateId].tier - 1][e.rarity];
async function createJourney(): Promise<GameState> {
  const sample = await clockSample();
  const fresh = newGame(BigInt(crypto.getRandomValues(new Uint32Array(1))[0]), {
    gameUtc: sample.wall, elapsed: sample.elapsed, boot: sample.boot, warning: false,
  });
  fresh.gold = "100";
  fresh.tickets = "1";
  fresh.rewards = ["Starting resources: 100 Gold, 1 Summon Ticket."];
  return fresh;
}
function englishEnemyInfo(a: import("../../packages/core/types").Abilities): string {
 const s = a.skill;
 const details = [`${s.name}: ${s.mp} MP; ${Math.round(s.coef * 100)}% ${s.stat}; ${s.hits} hit(s); ${s.targets} target(s); ${s.mode}; ${s.element}.`];
 if(s.status) details.push(`${s.status}: ${s.statusRaw ?? 0}.`);
 if(s.pierce) details.push(`Defense penetration: ${Math.round(s.pierce*100)}%.`);
 for(const [key,value] of Object.entries(a)) if(key!=="skill" && key!=="bonus") details.push(`${key.replace(/([A-Z])/g," $1")}: ${value}.`);
 return details.join(" ");
}
function traitLines(traits: string[]): string {
  return traits.map(t => `<span class="trait-line">${esc(t)}</span>`).join("");
}
function characterSkillsView(className: string): string {
  const skills = skillCards(className);
  const slots = Array.from({length:Math.max(3,skills.length)},(_,i)=>skills[i]);
  const picked = skills[selectedSkill];
  return `<div class="character-skills"><h3>Skills</h3><div class="skill-row">${slots.map((skill,i) => skill ? `<button class="skill-cell" data-skill-index="${i}" aria-label="${esc(skill.name)}"><img class="skill-icon" src="${skill.iconPath}" alt=""><b>${esc(skill.name)}</b><small>${skill.kind}</small></button>` : `<button class="skill-cell locked-skill" disabled aria-label="Passive unavailable"><span class="empty-skill"></span><small>Passive</small></button>`).join("")}</div></div>${picked ? `<div class="upgrade-overlay"><section class="upgrade-sheet skill-sheet" role="dialog" aria-label="Skill information"><button data-close-skill>← Back</button><h3>${esc(picked.name)}</h3><p class="skill-kind">${picked.kind} · ${esc(className)}</p><p class="skill-description">${esc(picked.text)}</p></section></div>` : ""}`;
}
function upgradeView(e: GameState["equipment"][number]) {
  const r = recipeById[e.templateId];
  const cost = e.enhancement < 20 ? enhancementCost(e) : null;
  const gold = cost ? BigInt(state.gold) >= cost.gold : false;
  const stones = cost ? BigInt(state.materials[STONE] ?? "0") >= cost.stones : false;
  const ready = !!cost && gold && stones;
  return `<div class="upgrade-overlay"><section class="upgrade-sheet" style="background-image:linear-gradient(#17141d88,#17141dbb),url('${art.forge}')"><button data-close-upgrade>← Back</button><h3>Upgrade · ${esc(r.slot)}</h3><div class="upgrade-art" style="background-image:linear-gradient(#16101955,#16101988),url('${art.forge}')"><img src="${art.item(e.templateId)}" alt="${esc(r.name)}"></div><strong>${esc(r.name)}${e.enhancement ? ` +${e.enhancement}` : ""}</strong>${equipmentStatBlocks(e)}<p>Enhancement Stone: <span class="${stones ? "" : "shortage-number"}">${state.materials[STONE] ?? "0"}</span>${cost ? ` / ${cost.stones}` : ""}</p><p>Gold: <span class="${gold ? "" : "shortage-number"}">${state.gold}</span>${cost ? ` / ${cost.gold}` : ""}</p><p>${cost ? `Success chance: ${cost.chance}%` : "Maximum enhancement reached"}</p>${button(cost ? "Upgrade" : "Max +20", {type:"enhance", id:e.id}, !ready)}</section></div>`;
}
function combatLogLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (/^(?:CRIT · )?.+ → .+ \d+\.?$/.test(line) && result.length && / · (?:Basic Attack|[^.]+)$/.test(result[result.length - 1])) {
      result[result.length - 1] += ` · ${line}`;
    } else result.push(line);
  }
  return result;
}
function render() {
  if (!state || document.activeElement?.matches("[data-journal-map]")) return;
  const previousArena = root.querySelector<HTMLElement>("#arena");
  const previousSummon = root.querySelector<HTMLElement>(".summon-overlay");
  const previousForge = root.querySelector<HTMLElement>(".forge-scene");
  const scrollPositions = [".expedition-select", ".gear-choice-grid", ".craft-sheet", ".inventory-scroll", ".character-stats"].map(selector => root.querySelector<HTMLElement>(selector)?.scrollTop ?? 0);
  navigationObserver?.disconnect();
  root.setAttribute("aria-busy", String(busy));
  const b = state.battle;
  if (b) lastBattle = b;
  else lastBattle = state.completedBattle ?? null;
  const inBattle = !!(b || state.farming || state.completedBattle);
  if (!inBattle) battleHidden = false;
  const showBattle = inBattle && tab === "World" && !battleHidden;
  document.body.classList.toggle("battle-mode", showBattle);
  document.body.classList.toggle("inventory-mode", !showBattle && tab === "Inventory");
  const navigation = `<nav aria-label="Main navigation">${["World", "Party", "Inventory", "Craft", "Journal"].map((t) => `<button data-tab="${t}" aria-current="${tab === t ? "page" : "false"}"><img src="${art.navigation(t)}" alt="" loading="lazy"><span>${t}</span></button>`).join("")}</nav>`;
  root.innerHTML = `${error ? `<aside role="alert">${esc(error)}</aside>` : ""}${state.clock.warning ? "<aside>Clock re-anchored. Unverified elapsed time earns no offline rewards.</aside>" : ""}${state.idle ? '<aside role="status">Recovering offline progress…</aside>' : ""}${navigation}<main>${showBattle ? battleView() : view()}</main>${forgeView()}<footer>Auto-save · revision ${state.revision} · ${state.chapterCleared ? "Chapter cleared" : "Journey in progress"}</footer>`;
  const summonNode = root.querySelector<HTMLElement>(".summon-overlay");
  if (summonNode && previousSummon && summonNode.dataset.sceneId === previousSummon.dataset.sceneId && summonNode.dataset.finished === previousSummon.dataset.finished) summonNode.replaceWith(previousSummon);
  const forgeNode = root.querySelector<HTMLElement>(".forge-scene");
  if (forgeNode && previousForge && forgeNode.dataset.sceneId === previousForge.dataset.sceneId && forgeNode.dataset.finished === previousForge.dataset.finished) forgeNode.replaceWith(previousForge);
  [".expedition-select", ".gear-choice-grid", ".craft-sheet", ".inventory-scroll", ".character-stats"].forEach((selector, i) => { const panel = root.querySelector<HTMLElement>(selector); if (panel) panel.scrollTop = scrollPositions[i]; });
  const navElement = root.querySelector<HTMLElement>("nav");
  if (navElement && typeof ResizeObserver !== "undefined") {
    navigationObserver = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--nav-height",
        navElement.getBoundingClientRect().height + "px",
      );
    });
    navigationObserver.observe(navElement);
  }
  let host = root.querySelector<HTMLElement>("#arena");
  if (host && previousArena) {
    host.replaceWith(previousArena);
    host = previousArena;
  }
  if (host) {
    showArena(host, state.battle ?? lastBattle);
    const log = root.querySelector<HTMLElement>(".log-entries");
    if (log) log.scrollTop = log.scrollHeight;
  } else clearArena();
}
function battleView() {
  const b = state.battle ?? lastBattle;
  const map = b?.map ?? state.farming ?? 1;
  const resting = !state.battle;
  const remaining = Math.max(0, Math.ceil((state.restUntil - state.clock.gameUtc) / 1000));
  return `<section class="arena"><div class="battle-heading"><small>${esc(content.mapNames[map - 1])} · ${esc(b?.kind ?? "normal")}</small><strong>${resting ? (state.farming ? `Next encounter in ${remaining}s` : "Battle complete") : `Round ${b!.round} / 30`}</strong></div><div id="arena" aria-label="Battlefield"></div><div class="battle-controls"><button data-back-combat>← Back</button>${button("Leave expedition", { type: "leave" })}</div><div class="combat-log" aria-label="Combat log" role="log"><small>COMBAT LOG</small><div class="log-entries">${combatLogLines((b?.log ?? []).slice(-30)).map(l => `<p>${esc(l)}</p>`).join("")}${resting && state.farming ? "<p>Next encounter begins in 2 seconds…</p>" : ""}</div></div></section>`;
}

function view(): string {
  if (tab === "World") {
    const activeMap = state.battle?.map ?? state.farming;
    const selection = pendingStart ? `<section class="expedition-select"><h2>${esc(content.mapNames[pendingStart.map - 1])} · Choose party</h2><p>Select the characters to add before entering. Up to four may join.</p><div class="party-roster">${state.characters.filter(c => characterMap(state,c.id) === null).map(c => `<div class="party-row"><img src="${art.character(c.className)}" alt=""><span><b>${esc(c.name ?? c.className)} · ${esc(c.className)} · ${classLevelLabel(c)}</b><small>${selectedExpeditionIds.includes(c.id) ? "Selected" : "Reserve"}</small></span><button data-toggle-expedition="${esc(c.id)}" ${!selectedExpeditionIds.includes(c.id) && selectedExpeditionIds.length >= 4 ? "disabled" : ""}>${selectedExpeditionIds.includes(c.id) ? "Remove" : "Add party"}</button></div>`).join("")}</div><div class="selection-actions"><button data-begin-expedition ${!selectedExpeditionIds.length ? "disabled" : ""}>Enter battle</button><button data-cancel-expedition>Cancel</button></div></section>` : "";
    return `${selection}<div class="grid">${content.mapNames.map((name, i) => {
      const m = i + 1, p = state.maps[i];
      return `<section class="map-card"><div class="map-art"><img class="map-thumb" src="${art.background(m)}" alt="" loading="lazy">${(state.farming === m || state.battle?.map === m || state.expeditions?.some(e=>e.map===m)) ? `<span class="map-swords" aria-label="Combat idle">⚔</span>` : ""}</div><div class="map-name-row"><h3>${esc(name)}</h3><span>Field Boss ${state.quota.wins[i]}/3</span></div><div class="map-actions">${(state.farming === m || state.battle?.map === m || state.expeditions?.some(e=>e.map===m)) ? `<button data-return-combat="${m}">Return combat</button>` : button("Enter field", { type: "start", map: m, kind: "normal" }, m > state.unlockedMap || activeMap === m)}${button("Challenge boss", { type: "start", map: m, kind: "boss" }, m > state.unlockedMap || activeMap === m || !!state.expeditions?.some(e=>e.map===m) || !bossReady(state, m) || state.quota.wins[i] >= 3)}</div>${m === 6 && state.hidden.discovered && !state.hidden.defeated ? button("The Unnamed Hanged", { type: "start", map: 6, kind: "hidden" }) : ""}${m === 8 && miniReady(state) ? button("Challenge mini boss", { type: "start", map: 8, kind: "mini" }) : ""}</section>`;
    }).join("")}</div>`;
  }
  if (tab === "Party") {
    const c = state.characters.find(ch => ch.id === selectedPartyId);
    if (c) {
      const characterNumbers = characterStats(state,c);
      const slotNames = ["Weapon","Hands","Feet","Head","Ring","Necklace"] as const;
      return `<section class="character-sheet"><div class="character-back"><button data-close-character>← Back</button></div><div class="character-overview"><img class="character-portrait" src="${art.character(c.className)}" alt="${esc(c.className)}"><div class="character-stats"><h2>${esc(c.name ?? c.className)} · ${esc(c.className)} · ${classLevelLabel(c)}</h2><p class="character-location">${c.gender === "female" ? "Female" : "Male"} · ${characterMap(state,c.id) === null ? "Reserve" : `Fighting in map ("${esc(content.mapNames[(characterMap(state,c.id) ?? 1) - 1])}")`}</p><div class="stat-grid">${Object.entries(characterNumbers).map(([key,value]) => `<div><b>${esc(key)}:</b><span>${value}</span></div>`).join("")}</div>${c.traits.length ? `<div class="trait-details"><b>Traits:</b>${c.traits.map(t => `<p class="trait-line">${esc(t)}</p>`).join("")}</div>` : ""}<div class="exp-line"><b>EXP:</b><span>${nextEvolutionLevel(c) === null && classLevel(c) === 75 ? "MAX" : choices(c).length ? "Evolve ready" : c.level === 75 ? `${c.classExp ?? 0} / ${content.exp[74]}` : `${c.exp} / ${content.exp[c.level - 1]}`}</span></div></div></div>${characterSkillsView(c.className)}<h3>Equipment slots</h3><div class="gear-grid">${slotNames.map(slot => { const worn = state.equipment.find(e => e.id === c.gear[slot]); const available = state.equipment.filter(e => !e.owner && recipeById[e.templateId].slot === slot && (recipeById[e.templateId].baseClass === "All" || recipeById[e.templateId].baseClass === c.baseClass)); return `<div class="gear-slot" ${worn ? `data-rarity="${worn.rarity}"` : ""}><small>${slot}</small><div class="gear-icon">${worn ? `<img src="${art.item(worn.templateId)}" alt="${esc(recipeById[worn.templateId].name)}">` : "◇"}</div><button data-choose-gear="${slot}" ${available.length === 0 ? "disabled" : ""}>Choose</button><button data-info-gear="${worn ? esc(worn.id) : ""}" ${worn ? "" : "disabled"}>Info</button><button data-upgrade-gear="${worn ? esc(worn.id) : ""}" ${worn ? "" : "disabled"}>Upgrade</button>${worn ? button("Remove", { type:"unequip", id:worn.id }) : `<button disabled>Remove</button>`}</div>`; }).join("")}</div>${selectedGearSlot ? `<div class="gear-picker"><section><div class="gear-picker-back"><button data-close-gear>← Back</button></div><h3>${esc(selectedGearSlot)} · ${esc(c.className)}</h3><div class="gear-choice-grid">${state.equipment.filter(e => !e.owner && recipeById[e.templateId].slot === selectedGearSlot && (recipeById[e.templateId].baseClass === "All" || recipeById[e.templateId].baseClass === c.baseClass)).map(e => `<div class="gear-choice" data-rarity="${e.rarity}"><div class="gear-choice-art"><img src="${art.item(e.templateId)}" alt="${esc(recipeById[e.templateId].name)}"></div><div class="gear-choice-info"><b>${esc(recipeById[e.templateId].name)}${e.enhancement ? ` +${e.enhancement}` : ""}</b>${equipmentStatBlocks(e)}</div>${button("Equip", { type:"equip", id:e.id, character:c.id })}</div>`).join("")}</div></section></div>` : ""}${selectedGearInfo && state.equipment.find(e => e.id === selectedGearInfo) ? gearInfoView(state.equipment.find(e => e.id === selectedGearInfo)!) : ""}${selectedUpgradeItem && state.equipment.find(e => e.id === selectedUpgradeItem) ? upgradeView(state.equipment.find(e => e.id === selectedUpgradeItem)!) : ""}${choices(c).length ? `<button class="evolve-trigger" data-open-evolve>Evolve</button>` : ""}${selectedEvolve && choices(c).length ? `<div class="evolve-overlay"><section class="evolve-sheet"><div class="evolve-back"><button data-close-evolve>← Back</button></div><h3>Choose evolution · ${esc(c.className)}</h3><div class="evolve-options">${choices(c).map(className => `<div class="evolve-option"><img src="${art.character(className)}" alt="${esc(className)}"><div><strong>${esc(className)}</strong><small>Lv ${c.level} · ${esc(c.baseClass)} path</small></div>${button("Evolve",{type:"advance",id:c.id,className})}</div>`).join("")}</div></section></div>` : ""}${button("Dismiss reserve",{type:"dismiss",id:c.id},characterMap(state,c.id)!==null || c.party !== null || state.characters.length === 1)}</section>`;
    }
    return `<section class="party-head"><h2>Your companions</h2><p>${state.characters.length} / ${state.rosterCapacity} roster slots · ${state.characters.filter(ch => characterMap(state,ch.id)!==null).length} active · up to 4 per map</p><div class="party-actions">${button("Summon", {type:"summon"})}<button data-open-roster>Roster</button></div>${rosterView()}${summonView()}</section><div class="character-list">${state.characters.map(ch => `<button class="character-strip" data-character-detail="${esc(ch.id)}"><img src="${art.character(ch.className)}" alt=""><span class="character-info"><small>${characterMap(state,ch.id) === null ? "RESERVE" : `Combat · ${esc(content.mapNames[(characterMap(state,ch.id) ?? 1) - 1])}`}</small><strong>${esc(ch.name ?? ch.className)} · ${esc(ch.className)} · ${classLevelLabel(ch)}</strong>${ch.traits.length ? `<span>${traitLines(ch.traits)}</span>` : ""}</span><span>›</span></button>`).join("")}</div>`;
  }
  if (tab === "Inventory") {
    const equipment = state.equipment.filter(e => e.owner === null);
    const materials = Object.entries(state.materials).filter(([, n]) => Number(n) > 0);
    const entries = inventoryTab === "Equipment" ? equipment : materials;
    const visible = entries.slice(page * 30, page * 30 + 30);
    const detail = inventoryTab === "Equipment"
      ? (() => {
          const e = equipment.find((e) => e.id === selectedItem);
          if (!e) return "<p>Choose equipment to inspect.</p>";
          const r = recipeById[e.templateId];
          return `<div class="item-detail" data-rarity="${e.rarity}"><img src="${art.item(e.templateId)}" alt=""><div><small>${content.rarities[e.rarity]} · ${r.slot} · ${r.baseClass}</small><h3>${esc(r.name)}${e.enhancement ? ` +${e.enhancement}` : ""}</h3>${equipmentStatBlocks(e)}<div class="item-actions">${button(`Sell · ${salePrice(e)} Gold`, { type: "sell", id: e.id, quantity: "1" }, false)}</div></div></div>`;
        })()
      : (() => {
          const count = state.materials[selectedItem] ?? 0;
          if (!count) return "<p>Choose a material to inspect.</p>";
          return `<div class="item-detail"><img src="${art.material(selectedItem)}" alt=""><div><h3>${esc(materialById[selectedItem]?.name ?? selectedItem)} ×${count}</h3><p>Tier ${materialById[selectedItem]?.tier ?? "?"} · Sell value ${materialById[selectedItem]?.sale ?? 0} Gold each</p><p>Crafts: ${esc(recipes.filter(r => r.ingredients.some(m => m.id === selectedItem)).slice(0, 8).map(r => r.name).join(" · ") || "No discovered recipe")}</p>${button(`Sell 1 · ${materialById[selectedItem]?.sale ?? 0} Gold`, { type: "sell", id: selectedItem, quantity: "1" }, selectedItem === "mat_nameless_seal")}</div></div>`;
        })();
    return `<div class="inventory-screen"><section class="inventory-head"><div class="inventory-title-row"><h2>Inventory ${used(state)} / ${state.capacity}</h2><span class="inventory-gold">${esc(state.gold)} Gold</span></div><div class="inventory-currencies"><div class="summon-ticket-slot"><img src="/art/currency/summon-ticket.png" alt="Summon Ticket"><strong>Summon Ticket</strong><span>×${esc(state.tickets)}</span></div></div>${costButton("Add bag slot ·", String(bagCost(state)), "Gold", { type: "bag-slot" }, BigInt(state.gold) < bagCost(state))}${button("Collect pending rewards", { type: "store-pending" })}<p>Pending: ${esc(Object.entries(state.pending).map(([id, n]) => `${materialById[id]?.name} ×${n}`).join(", ") || "none")}</p><div class="inventory-tabs">${["Equipment", "Materials"].map((t) => `<button data-inventory-tab="${t}" aria-current="${inventoryTab === t ? "page" : "false"}">${t}</button>`).join("")}</div></section><section class="inventory-body"><div class="inventory-scroll"><div class="inventory-grid">${Array.from({ length: 30 }, (_, i) => {
      const entry = visible[i];
      if (!entry) return `<div class="item-slot empty" aria-hidden="true"></div>`;
      if (inventoryTab === "Equipment") {
        const e = entry as typeof equipment[number];
        return `<button class="item-slot" data-rarity="${e.rarity}" data-item="${esc(e.id)}" aria-label="${esc(recipeById[e.templateId].name)}${e.enhancement ? ` +${e.enhancement}` : ""}" aria-pressed="${selectedItem === e.id}"><img src="${art.item(e.templateId)}" alt="" loading="lazy"><strong class="item-name">${esc(recipeById[e.templateId].name)}</strong><small>${e.enhancement ? `+${e.enhancement}` : ""}</small></button>`;
      }
      const [id, count] = entry as [string, string];
      return `<button class="item-slot" data-item="${esc(id)}" aria-label="${esc(materialById[id]?.name ?? id)} ×${count}" aria-pressed="${selectedItem === id}"><img src="${art.material(id)}" alt="" loading="lazy"><strong class="item-name">${esc(materialById[id]?.name ?? id)}</strong><small>×${count}</small></button>`;
    }).join("")}</div></div><div class="pager"><button data-page="-1" ${page === 0 ? "disabled" : ""}>Previous</button><span>${page + 1} / ${Math.max(1, Math.ceil(entries.length / 30))}</span><button data-page="1" ${(page + 1) * 30 >= entries.length ? "disabled" : ""}>Next</button></div>${selectedItem ? `<div class="item-overlay"><section class="item-sheet"><button data-close-item>← Inventory</button>${detail}</section></div>` : ""}</section></div>`;
  }
  if (tab === "Craft") {
    const available = recipes.filter(r => r.tier === craftTier && r.tier <= state.unlockedMap);
    const picked = available.find(r => r.id === selectedRecipeId);
    return `<section class="forge-head"><h2>The forge</h2><p>Choose a recipe to see the required materials.</p><label class="tier-select">Craft tier: <select data-craft-tier-select aria-label="Craft tier">${Array.from({length:state.unlockedMap},(_,i) => `<option value="${i+1}" ${craftTier === i+1 ? "selected" : ""}>Tier ${i+1}</option>`).join("")}</select></label></section><div class="forge-list">${available.map(r => `<section class="craft-row"><button class="craft-open" data-recipe="${esc(r.id)}" aria-label="View materials for ${esc(r.name)}"><img src="${art.item(r.id)}" alt=""><span><small>TIER ${r.tier} · ${r.baseClass} · ${r.slot}</small><strong>${esc(r.name)}</strong><em>${positiveStats(r.stats)}</em></span></button><span class="craft-count ${!canCraft(state,r) ? "shortage-number" : ""}">${canCraft(state,r) ? Number(r.ingredients.reduce((n,m) => { const count = BigInt(state.materials[m.id] ?? "0") / BigInt(m.quantity); return count < n ? count : n; }, 999999999n)) : 0}/1</span>${button("Craft", { type:"craft", id:r.id }, !canCraft(state,r))}</section>`).join("")}</div>${picked ? `<div class="craft-overlay"><section class="craft-sheet"><button data-close-recipe>← The forge</button><div class="craft-sheet-title"><img src="${art.item(picked.id)}" alt=""><div><h2>${esc(picked.name)}</h2><p>${positiveStats(picked.stats)}</p>${picked.fixed ? `<p>${esc(picked.fixed)}</p>` : ""}</div></div><h3>Required materials</h3><div class="craft-materials">${picked.ingredients.map(m => { const have = BigInt(state.materials[m.id] ?? "0"); return `<div class="craft-material"><img src="${art.material(m.id)}" alt=""><span>${esc(m.name)}<small><span class="${have < BigInt(m.quantity) ? "shortage-number" : ""}">${have}</span>/${m.quantity}</small></span></div>`; }).join("")}</div>${button("Craft", { type:"craft", id:picked.id }, !canCraft(state,picked))}</section></div>` : ""}`;
  }
  if (journalTab !== "Daily") return journalNavigation() + bestiaryView();
  return journalNavigation() + `<section><h2>Daily journal</h2><p>Resets at midnight UTC+7. Complete quests, then tap a chest to claim each milestone.</p>${state.daily.tasks
    .map((t) => {
      const d = content.daily.find((d) => d.id === t.id)!;
      return `<p>${t.done ? "✓" : "○"} ${esc(d.name)} · ${t.progress}/${t.target ?? d.target}</p>`;
    })
    .join(
      "",
    )}<div class="daily-rewards">${[1,3,5].map(m => { const claimed = state.daily.claimedMilestones?.includes(m); const ready = state.daily.tasks.filter(t => t.done).length >= m; const reward = m === 1 ? "500 Gold" : m === 3 ? "5 Enhancement Stones" : "1 Summon Ticket"; return `<div class="daily-chest ${claimed ? "claimed" : ready ? "ready" : "locked"}"><img src="/art/daily-chest.png" alt="Treasure chest"><b>${m} quests</b><span>${reward}</span>${button(claimed ? "Claimed" : ready ? "Claim" : "Locked", {type:"claim-daily",milestone:m}, !!claimed || !ready)}</div>`; }).join("")}</div><h3>Audio</h3><label>Music <input id="music" type="range" min="0" max="1" step="0.1" value="${state.settings.music}"></label><label>SFX <input id="sfx" type="range" min="0" max="1" step="0.1" value="${state.settings.sfx}"></label><h3>Save management</h3><button id="export">Export backup</button><button id="import">Import backup</button><p>Import replaces active progress and preserves the previous snapshots. Keep an exported backup.</p><h3>Recent rewards</h3><div class="log">${state.rewards
    .slice()
    .reverse()
    .map((r) => `<p>${esc(r)}</p>`)
    .join("")}</div></section>`;
}
function journalNavigation() {
  return `<section class="journal-tabs">${["Daily","Monsters","Bosses"].map(t => `<button data-journal-tab="${t}" aria-pressed="${journalTab === t}">${t}</button>`).join("")}</section>`;
}
function bestiaryView(): string {
  const monsters = journalTab === "Monsters";
  const list = enemies.filter(e => monsters ? e.kind === "normal" && e.map === journalMap : e.kind !== "normal");
  const discovered = (e: typeof enemies[number]) => state.maps[e.map-1].seen.includes(e.id) || (e.kind === "boss" && state.maps[e.map-1].bossDefeated) || (e.kind === "hidden" && state.hidden.defeated) || (e.kind === "mini" && state.miniCleared);
  const selected = list.find(e => e.id === selectedMonster && discovered(e));
  let detail = "";
  if (selected) {
    const e = selected, a = enemyActor(e.id,0);
    const drops: [string,string][] = [];
    if(e.kind === "normal") {
      if(e.map === 1) {
        const names = e.name === "Ash Wolf" ? ["Raw Hide"] : e.name === "Rotting Skeleton" ? ["Rotten Bone Shard"] : e.name === "Snake" ? ["Snake Scale"] : ["Dry Wood","Torn Cloth"];
        names.forEach(n => drops.push([n,names.length === 1 ? "15% per enemy" : "7.5% per enemy"]));
      } else e.drops.filter(d=>d!=="—").forEach((d,i)=>drops.push([d,i===0?"15% per enemy":"6% per enemy"]));
      drops.push([content.tiers[e.map-1]+" Scrap",e.map===1?"15% per battle":"12% per battle"]);
      if(e.map===1) ["Dry Wood","Torn Cloth"].forEach(n=>drops.push([n,"4.5% extra per battle"]));
    } else if(e.kind === "boss") {
      drops.push([bossRewardMaterials[e.map-1],"64% per victory"]);
      if(e.map===6) drops.push(["Gallows Ember","6.4% per victory"]);
    } else drops.push([e.kind === "hidden" ? "Nameless Seal" : "Castellan Sigil","Guaranteed on victory"]);
    if(e.map>=2 && ["normal","boss"].includes(e.kind)) drops.push(["Enhancement Stone",e.kind==="normal"?"0.45% per defeated enemy":"4.8% per victory"]);
    detail = `<div class="upgrade-overlay"><section class="upgrade-sheet monster-info" role="dialog" aria-label="${esc(e.name)} information"><button data-close-monster>← Back</button><div class="bestiary-title"><img src="${art.enemy(e.id)}" alt=""><h3>${esc(e.name)}</h3></div><div class="enemy-info-frame"><h4>Stats</h4><div class="stat-grid">${Object.entries(a.stats).map(([k,v])=>`<div><b>${esc(k)}:</b><span>${v}</span></div>`).join("")}</div></div><div class="enemy-info-frame"><h4>Skills</h4><div class="enemy-skill-tile"><img src="/art/skills/${a.abilities.skill.stat === "MATK" ? 4 : 0}.png" alt=""><div><strong>${esc(a.abilities.skill.name)}</strong><p>${esc(englishEnemyInfo(a.abilities))}</p></div></div></div><div class="enemy-info-frame"><h4>Material drops</h4><div class="enemy-drop-grid">${drops.map(([name,rate])=>{const m=content.materials.find(m=>m.name===name);return `<div class="enemy-drop-tile">${m?`<img src="${art.material(m.id)}" alt="${esc(name)}">`:""}<strong>${esc(name)}</strong><small>${rate}</small></div>`;}).join("")}</div></div></section></div>`;
  }
  return `<section><h2>${monsters?"Monster":"Boss"} collection</h2>${monsters?`<label>Map <select data-journal-map>${content.mapNames.map((name,i)=>`<option value="${i+1}" ${journalMap===i+1?"selected":""}>Map ${i+1} · ${esc(name)}</option>`).join("")}</select></label>`:""}<p>${list.filter(discovered).length} / ${list.length} discovered · Complete a battle to reveal its ${monsters?"monsters":"bosses"}.</p></section><div class="monster-grid">${list.map(e=>discovered(e)?`<button class="monster-card" data-monster-info="${esc(e.id)}"><img src="${art.enemy(e.id)}" alt="${esc(e.name)}"><b>${esc(e.name)}</b></button>`:`<button class="monster-card unknown-monster" disabled aria-label="Unknown ${monsters?"monster":"boss"}"><span class="monster-shadow"></span><b>???</b></button>`).join("")}</div>${detail}`;
}
function enqueue(job: () => Promise<void>) {
  queue = queue.then(async () => {
    busy = true;
    try {
      await job();
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      render();
    }
  });
  return queue;
}
async function save(next: GameState, replace = false) {
  try {
    await persistence.commit(next, replace);
    state = next;
    frozen = false;
  } catch (e) {
    frozen = true;
    throw Error(
      "Saving failed. Gameplay paused; export a backup or reload. " + String(e),
    );
  }
}
async function recover() {
  const sample = await clockSample(),
    next = structuredClone(state),
    previous = next.clock.gameUtc;
  next.clock = advanceClock(next.clock, sample);
  const elapsed = next.clock.gameUtc - previous;
  if (!next.idle) {
    if (next.farming || next.expeditions?.some(e=>e.farming)) beginIdle(next, previous, elapsed);
    else if (next.battle) next.battle.startedAt += elapsed;
  }
  next.revision++;
  await save(next);
  while (state.idle) {
    const chunk = structuredClone(state);
    stepIdle(chunk);
    chunk.revision++;
    await save(chunk);
    render();
    await new Promise((r) => setTimeout(r, 0));
  }
}
root.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset.journalMap !== undefined) { journalMap = Number(target.value); selectedMonster = ""; target.blur(); render(); return; }
  if (target.dataset.craftTierSelect !== undefined) {
    craftTier = Math.min(state.unlockedMap, Math.max(1, Number(target.value)));
    selectedRecipeId = "";
    render();
  }
});
root.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!el || el.disabled) return;
  if (el.dataset.skillIndex !== undefined) { selectedSkill = Number(el.dataset.skillIndex); render(); return; }
  if (el.dataset.closeSkill !== undefined) { selectedSkill = -1; render(); return; }
  if (el.dataset.closeForge !== undefined) { forgeScene = null; render(); return; }
  if (el.dataset.backCombat !== undefined) { battleHidden = true; tab = "World"; render(); return; }
  if (el.dataset.returnCombat !== undefined) { battleHidden = false; tab = "World"; const map=Number(el.dataset.returnCombat); if(state.expeditions?.some(e=>e.map===map)) void enqueue(()=>save(execute(state,{type:"resume",map},crypto.randomUUID()))); else render(); return; }
  if (el.dataset.tab) {
    if (tab === "Party" && el.dataset.tab !== "Party") { selectedPartyId = ""; selectedSkill = -1; selectedGearSlot = ""; selectedUpgradeItem = ""; selectedGearInfo = ""; }
    if (el.dataset.tab === "Party") { selectedPartyId = ""; selectedSkill = -1; selectedGearSlot = ""; selectedUpgradeItem = ""; selectedGearInfo = ""; }
    tab = el.dataset.tab;
    render();
    return;
  }
  if (el.dataset.cancelExpedition !== undefined) { pendingStart = null; selectedExpeditionIds = []; render(); return; }
  if (el.dataset.toggleExpedition) { const id = el.dataset.toggleExpedition; selectedExpeditionIds = selectedExpeditionIds.includes(id) ? selectedExpeditionIds.filter(x => x !== id) : [...selectedExpeditionIds, id]; render(); return; }
  if (el.dataset.beginExpedition !== undefined && pendingStart) {
    const cmd: Command = { type: "start", ...pendingStart, partyIds: [...selectedExpeditionIds] };
    pendingStart = null;
    selectedExpeditionIds = [];
    battleHidden = false;
    void enqueue(() => save(execute(state, cmd, crypto.randomUUID())));
    return;
  }
  if (el.dataset.monsterInfo) { selectedMonster = el.dataset.monsterInfo; render(); return; }
  if (el.dataset.closeMonster !== undefined) { selectedMonster = ""; render(); return; }
  if (el.dataset.journalTab) { journalTab = el.dataset.journalTab; selectedMonster = ""; render(); return; }
  if (el.dataset.openRoster !== undefined) { rosterOpen = true; render(); return; }
  if (el.dataset.closeRoster !== undefined) { rosterOpen = false; render(); return; }
  if (el.dataset.closeSummon !== undefined) { summonScene = null; render(); return; }
  if (el.dataset.closeCharacter !== undefined) { selectedPartyId = ""; selectedSkill = -1; selectedGearSlot = ""; selectedUpgradeItem = ""; selectedGearInfo = ""; selectedEvolve = false; render(); return; }
  if (el.dataset.openEvolve !== undefined) { selectedEvolve = true; render(); return; }
  if (el.dataset.closeEvolve !== undefined) { selectedEvolve = false; render(); return; }
  if (el.dataset.chooseGear) { selectedGearSlot = el.dataset.chooseGear; render(); return; }
  if (el.dataset.closeGear !== undefined) { selectedGearSlot = ""; selectedUpgradeItem = ""; render(); return; }
  if (el.dataset.infoGear) { selectedGearInfo = el.dataset.infoGear; render(); return; }
  if (el.dataset.closeInfo !== undefined) { selectedGearInfo = ""; render(); return; }
  if (el.dataset.upgradeGear) { selectedUpgradeItem = el.dataset.upgradeGear; render(); return; }
  if (el.dataset.closeUpgrade !== undefined) { selectedUpgradeItem = ""; render(); return; }
  if (el.dataset.recipe) { selectedRecipeId = el.dataset.recipe; render(); return; }
  if (el.dataset.closeRecipe !== undefined) { selectedRecipeId = ""; render(); return; }
  if (el.dataset.characterDetail) { selectedPartyId = el.dataset.characterDetail; selectedSkill = -1; selectedUpgradeItem = ""; selectedEvolve = false; render(); return; }
  if (el.dataset.closeItem !== undefined) { selectedItem = ""; render(); return; }
  if (el.dataset.inventoryTab) {
    inventoryTab = el.dataset.inventoryTab as "Equipment" | "Materials";
    selectedItem = "";
    page = 0;
    render();
    return;
  }
  if (el.dataset.item) {
    selectedItem = el.dataset.item;
    render();
    return;
  }
  if (el.dataset.page) {
    page = Math.max(0, page + Number(el.dataset.page));
    render();
    return;
  }
  const raw = el.dataset.command;
  if (raw) {
    if (frozen) {
      error =
        "Gameplay paused after a save failure. Export a backup or reload.";
      render();
      return;
    }
    const cmd = JSON.parse(raw) as Command;
    if (forgeScene && ["craft","enhance"].includes(cmd.type)) return;
    if (summonScene && cmd.type === "summon") return;
    if (cmd.type === "equip") selectedGearSlot = "";
    if (cmd.type === "advance") selectedEvolve = false;
    if (cmd.type === "craft") selectedRecipeId = "";
    if (cmd.type === "leave") battleHidden = false;
    if (cmd.type === "start") { pendingStart = { map: cmd.map, kind: cmd.kind as "normal" | "boss" | "hidden" | "mini" }; selectedExpeditionIds = []; render(); return; }
    if (
      ["sell", "dismiss"].includes(cmd.type) &&
      !confirm("Confirm " + cmd.type + "? This changes your inventory or Gold.")
    )
      return;
    if (pending.has(raw)) return;
    pending.add(raw);
    void enqueue(async () => {
      try {
        const before = state;
        const next = execute(state, cmd, crypto.randomUUID());
        await save(next);
        if (cmd.type === "summon") {
          const c = next.characters.find(c => !before.characters.some(old => old.id === c.id))!;
          summonScene = {name:c.name ?? c.className, className:c.className, traits:[...c.traits], finished:false, id:crypto.randomUUID()};
          const id = summonScene.id;
          setTimeout(() => { if (summonScene?.id === id) { summonScene.finished = true; render(); } }, 2500);
          render();
        }
        if (cmd.type === "craft" || cmd.type === "enhance") {
          const item = cmd.type === "craft" ? next.equipment.find(e => !before.equipment.some(old => old.id === e.id)) : next.equipment.find(e => e.id === cmd.id);
          if (item) {
            const succeeded = cmd.type === "craft" || item.enhancement > (before.equipment.find(e => e.id === item.id)?.enhancement ?? 0);
            forgeScene = { id:crypto.randomUUID(), templateId:item.templateId, mode:cmd.type, finished:false, rarity:item.rarity, message:cmd.type === "craft" ? `${content.rarities[item.rarity]} · Craft complete` : succeeded ? `Upgrade successful · +${item.enhancement}` : `Upgrade failed · +${item.enhancement}` };
            const sceneId = forgeScene.id;
            setTimeout(() => { if (forgeScene?.id === sceneId) { forgeScene.finished = true; render(); } }, 2500);
          }
        }
        updateAudio(state.settings.music, state.settings.sfx, true);
      } finally {
        pending.delete(raw);
      }
    });
  } else if (el.id === "export") void enqueue(() => exportBackup(state));
  else if (el.id === "import")
    void enqueue(async () => {
      if (state.battle || state.farming || state.expeditions?.length)
        throw Error("Leave all expeditions before importing");
      const imported = await importBackup();
      if (
        !confirm(
          "Replace progress with revision " +
            imported.revision +
            " · " +
            imported.gold +
            " Gold · Map " +
            imported.unlockedMap +
            "?",
        )
      )
        return;
      const sample = await clockSample();
      imported.clock = {
        gameUtc: imported.clock.gameUtc,
        elapsed: sample.elapsed,
        boot: sample.boot,
        warning: true,
      };
      imported.revision++;
      await save(imported, true);
      await recover();
    });
});
root.addEventListener("change", (e) => {
  const input = e.target as HTMLSelectElement;
  if (input.id === "music" || input.id === "sfx") {
    const music = Number(root.querySelector<HTMLInputElement>("#music")!.value),
      sfx = Number(root.querySelector<HTMLInputElement>("#sfx")!.value);
    updateAudio(music, sfx);
    void enqueue(() =>
      save(
        execute(state, { type: "settings", music, sfx }, crypto.randomUUID()),
      ),
    );
  }
  if (input.id === "character") {
    selected = input.value;
    render();
  }
});
let last = 0;
setInterval(() => {
  if (
    !state ||
    busy ||
    frozen ||
    nativeSuspended ||
    document.hidden ||
    state.idle
  )
    return;
  const now = performance.now();
  if (now - last < 750) return;
  last = now;
  void enqueue(async () => {
    const next = structuredClone(state);
    next.clock = advanceClock(next.clock, await clockSample());
    advanceTo(next, next.clock.gameUtc, false, 100);
    next.revision++;
    await save(next);
  });
}, 250);
document.addEventListener("visibilitychange", () => {
  if (state) {
    updateAudio(state.settings.music, state.settings.sfx);
    if (!document.hidden && !frozen) { returnWorldMenu(); void enqueue(recover); }
  }
});
root.innerHTML = '<section role="status">Opening the gates…</section>';
void enqueue(async () => {
  const loaded = await persistence.load();
  if (loaded.state) {
    state = loaded.state;
    ensureCharacterIdentities(state);
    delete state.testResetVersion;
    delete state.boostedTestVersion;
  } else {
    state = await createJourney();
    await persistence.commit(state);
  }
  await recover();
}).then(() => {
  bootReady = true;
  if (!state) {
    root.innerHTML = `<section role="alert"><h1>Save recovery required</h1><p>${esc(error)}</p><button id="restore">Import a verified backup</button></section>`;
    root.querySelector("#restore")?.addEventListener(
      "click",
      () =>
        void enqueue(async () => {
          const s = await importBackup();
          await save(s, true);
          await recover();
        }),
    );
  }
});

window.addEventListener("abyss-native-resume", () => {
  nativeSuspended = false;
  returnWorldMenu();
  if (state) updateAudio(state.settings.music, state.settings.sfx);
  if (state && !frozen) void enqueue(recover);
});

window.addEventListener("abyss-native-pause", () => {
  nativeSuspended = true;
  if (state) updateAudio(state.settings.music, state.settings.sfx, false, true);
});

root.addEventListener("focusout", event => { if ((event.target as HTMLElement)?.matches("[data-journal-map]")) setTimeout(render, 0); });
