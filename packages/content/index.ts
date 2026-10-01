import raw from "./data.json";
import type { EnemyDefinition, Recipe, BaseClass, Stats } from "../core/types";
export const content = raw;
export const enemies = raw.enemies as EnemyDefinition[];
export const recipes = raw.recipes as Recipe[];
export const enemyById = Object.fromEntries(enemies.map((x) => [x.id, x]));
export const recipeById = Object.fromEntries(recipes.map((x) => [x.id, x]));
export const materialById = Object.fromEntries(
  raw.materials.map((x) => [x.id, x]),
);
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
export function baseStats(c: BaseClass, l: number): Stats {
  const v = raw.stats[c][l - 1];
  if (!v) throw Error("Unknown level");
  return {
    HP: v[1],
    ATK: v[2],
    MATK: v[3],
    DEF: v[4],
    ACC: 100,
    CRIT: c === "Rogue" ? 10 : 5,
    EVA: c === "Rogue" ? 10 : 5,
  };
}
export const slots = [
  "Weapon",
  "Hands",
  "Feet",
  "Head",
  "Ring",
  "Necklace",
] as const;
