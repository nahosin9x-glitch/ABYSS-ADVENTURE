import type { Actor, Battle } from "../../packages/core/types";
import { actorArt, art } from "./art";
import { enemyById } from "../../packages/content";

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
let hostShown: HTMLElement | null = null;
let battleId = "";
let actionKey = "";
let lastVisual = 0;
const hpBefore = new Map<string, number>();
const shieldBefore = new Map<string, number>();
const effectsSeen = new Set<string>();

function actorCard(actor: Actor, battle: Battle): string {
  const boss = actor.kind === "enemy" && !!enemyById[actor.templateId] && enemyById[actor.templateId].kind !== "normal";
  return `<div class="battle-sprite ${boss ? "boss-sprite" : ""} ${actor.hp <= 0 ? "fallen" : ""}" data-actor-id="${esc(actor.id)}" title="${esc(actor.name)} · ${actor.hp}/${actor.stats.HP} HP"><div class="sprite-image"><span class="slash-mark" aria-hidden="true"></span><img src="${actor.hp <= 0 ? art.unit("Gravestone") : actorArt(actor, battle)}" alt="${esc(actor.name)}" draggable="false"></div><strong>${esc(actor.name)}</strong><progress value="${Math.max(0, actor.hp)}" max="${Math.max(1, actor.stats.HP)}"></progress><div class="sprite-status">${actor.statuses.slice(0, 4).map(st => `<img src="${art.status(st.name)}" alt="${esc(st.name)}" title="${esc(st.name)}">`).join("")}</div></div>`;
}

export function showArena(host: HTMLElement, battle: Battle | null) {
  host.style.backgroundImage = battle ? `linear-gradient(#0b0b1266,#0b0b1266),url("${art.background(battle.map)}")` : "";
  if (!battle) { clearArena(); host.replaceChildren(); return; }
  const layout = ["enemy", "player"].flatMap(side => battle.actors.filter(a => a.side === side).map(a => a.id)).join("|");
  const existing = Array.from(host.querySelectorAll<HTMLElement>(".battle-sprite")).map(e => e.dataset.actorId).join("|");
  if (host !== hostShown || battle.id !== battleId || layout !== existing) {
    hostShown = host;
    battleId = battle.id;
    actionKey = "";
    lastVisual = battle.visualSequence ?? 0;
    hpBefore.clear(); shieldBefore.clear(); effectsSeen.clear();
    host.innerHTML = ["enemy", "player"].map(side => `<div class="battle-side ${side}">${battle.actors.filter(a => a.side === side).map(a => actorCard(a, battle)).join("")}</div>`).join("");
  }
  const nextAction = battle.action ? `${battle.id}|${battle.action.actor}|${battle.action.start}` : "";
  if (nextAction !== actionKey) {
    host.querySelectorAll(".battle-sprite").forEach(e => e.classList.remove("casting"));
    actionKey = nextAction;
    if (battle.action) {
      const actor = Array.from(host.querySelectorAll<HTMLElement>(".battle-sprite")).find(e => e.dataset.actorId === battle.action!.actor);
      if (battle.action.isSkill || !battle.visualEvents) actor?.classList.add(battle.action.isSkill ? "casting" : "attacking");
    }
  }
  for (const actor of battle.actors) {
    const node = Array.from(host.querySelectorAll<HTMLElement>(".battle-sprite")).find(e => e.dataset.actorId === actor.id);
    if (!node) continue;
    const hpDelta = hpBefore.has(actor.id) ? actor.hp - hpBefore.get(actor.id)! : 0;
    const shieldDelta = shieldBefore.has(actor.id) ? (actor.shield ?? 0) - shieldBefore.get(actor.id)! : 0;
    hpBefore.set(actor.id, actor.hp);
    shieldBefore.set(actor.id, actor.shield ?? 0);
    const delta = hpDelta || (shieldDelta < 0 ? shieldDelta : 0);
    const effectKey = `${actionKey || `${battle.id}|${battle.time}`}|${actor.id}`;
    if (!battle.visualEvents && delta && !effectsSeen.has(effectKey)) {
      effectsSeen.add(effectKey);
      const image = node.querySelector<HTMLElement>(".sprite-image")!;
      const popup = host.ownerDocument.createElement("span");
      popup.className = `hp-popup ${delta > 0 ? "hp-heal" : "hp-damage"}`;
      popup.textContent = `${delta > 0 ? "+" : "−"}${Math.abs(delta)} HP`;
      image.append(popup);
      if (delta < 0) node.classList.add("struck");
      if (delta < 0 && battle.action?.isSkill) node.classList.add("spell-impact");
      setTimeout(() => { popup.remove(); node.classList.remove("struck", "spell-impact"); }, 900);
    }
    const finalHit = actor.hp <= 0 && battle.visualEvents?.some(e => e.sequence > lastVisual && e.target === actor.id && e.value < 0);
    node.classList.toggle("fallen", actor.hp <= 0 && !finalHit);
    node.title = `${actor.name} · ${actor.hp}/${actor.stats.HP} HP`;
    const img = node.querySelector<HTMLImageElement>(".sprite-image img")!;
    const src = actor.hp <= 0 && !finalHit ? art.unit("Gravestone") : actorArt(actor, battle);
    if (img.getAttribute("src") !== src) img.src = src;
    const bar = node.querySelector<HTMLProgressElement>("progress")!;
    bar.value = Math.max(0, actor.hp);
    bar.max = Math.max(1, actor.stats.HP);
    if (finalHit) setTimeout(() => { if (bar.value === 0) { img.src = art.unit("Gravestone"); node.classList.add("fallen"); } }, 480);
  }
  for (const event of battle.visualEvents ?? []) {
    if (event.sequence <= lastVisual) continue;
    lastVisual = event.sequence;
    const effect = `${event.action}|${event.target}`;
    if (effectsSeen.has(effect)) continue;
    effectsSeen.add(effect);
    const nodes = Array.from(host.querySelectorAll<HTMLElement>(".battle-sprite"));
    const target = nodes.find(n => n.dataset.actorId === event.target);
    const source = nodes.find(n => n.dataset.actorId === event.source);
    if (!target) continue;
    const popup = host.ownerDocument.createElement("span");
    popup.className = `hp-popup ${event.value > 0 ? "hp-heal" : "hp-damage"}`;
    popup.textContent = `${event.value > 0 ? "+" : "−"}${Math.abs(event.value)} HP`;
    target.querySelector(".sprite-image")!.append(popup);
    if (event.value < 0) {
      target.classList.add("struck");
      const sourceKey = `source|${event.action}`;
      if (!effectsSeen.has(sourceKey)) {
        effectsSeen.add(sourceKey);
        source?.classList.add("attacking");
        setTimeout(() => source?.classList.remove("attacking"), 480);
      }
    }
    setTimeout(() => target.classList.remove("struck"), 480);
    setTimeout(() => popup.remove(), 900);
  }
}
export function clearArena() {
  hostShown = null; battleId = ""; actionKey = ""; lastVisual = 0;
  hpBefore.clear(); shieldBefore.clear(); effectsSeen.clear();
}
