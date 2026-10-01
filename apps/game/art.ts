import type { Actor, Battle } from "../../packages/core/types";

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const art = {
  character: (className: string) => `/art/classes/${slug(className)}.png`,
  enemy: (id: string) => `/art/enemies/${id}.png`,
  item: (id: string) => `/art/items/${id}.png`,
  material: (id: string) => `/art/materials/${id}.png`,
  status: (name: string) => `/art/statuses/${slug(name)}.png`,
  navigation: (name: string) => `/art/navigation/${slug(name)}.png`,
  background: (map: number) => `/art/backgrounds/map${String(map).padStart(2, "0")}.webp`,
  menu: "/art/backgrounds/menu.webp",
  forge: "/art/backgrounds/forge.webp",
  unit: (name: string) => `/art/units/${slug(name)}.png`,
};

export function actorArt(actor: Actor, battle: Battle): string {
  if (actor.templateId === "pale_squirrel") return art.unit("Pale Squirrel");
  if (actor.kind === "character") return art.character(actor.templateId);
  if (actor.kind === "enemy") return art.enemy(actor.templateId);
  if (actor.side === "enemy") return art.unit(actor.name);
  const owner = battle.actors.find((other) => other.id === actor.owner);
  const tier = owner?.abilities.summon ?? 0;
  return art.unit(["Summoner", "Necromancer", "Devil Lich"][tier]);
}
