import { Capacitor, registerPlugin } from "@capacitor/core";
import type { ClockAnchor, GameState } from "../core/types";
import { content, enemyById, recipeById, materialById } from "../content";
import { traitPool } from "../characters";
export interface ClockSample {
  elapsed: number;
  boot: string | null;
  wall: number;
}
interface NativeBridge {
  clock(): Promise<ClockSample>;
  read(): Promise<{ records: string[]; storageRevision: number }>;
  commit(input: {
    payload: string;
    revision: number;
    expectedRevision: number;
    replace: boolean;
    quarantine: boolean;
  }): Promise<void>;
  exportFile(input: { payload: string; name: string }): Promise<void>;
  importFile(): Promise<{ payload: string }>;
}
// A small native host used only by the standalone gameplay-test APK.
// The normal Capacitor build keeps using the registered plugin below.
const previewHost = (
  globalThis as typeof globalThis & {
    AbyssPreviewNative?: { call(payload: string): void };
  }
).AbyssPreviewNative;
const previewPending = new Map<
  string,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
if (previewHost)
  (globalThis as any).__abyssNativeReply = (text: string) => {
    const result = JSON.parse(text),
      pending = previewPending.get(result.id);
    if (!pending) return;
    previewPending.delete(result.id);
    if (result.error) pending.reject(Error(result.error));
    else pending.resolve(result.value);
  };
function previewCall<T>(method: string, args: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    previewPending.set(id, { resolve: (value) => resolve(value as T), reject });
    try {
      previewHost!.call(JSON.stringify({ id, method, args }));
    } catch (error) {
      previewPending.delete(id);
      reject(error);
    }
  });
}
const Native: NativeBridge = previewHost
  ? {
      clock: () => previewCall("clock"),
      read: () => previewCall("read"),
      commit: (args) => previewCall("commit", args),
      exportFile: (args) => previewCall("exportFile", args),
      importFile: () => previewCall("importFile"),
    }
  : registerPlugin<NativeBridge>("AbyssNative");
export const native = !!previewHost || Capacitor.isNativePlatform();
export async function clockSample(): Promise<ClockSample> {
  return native
    ? Native.clock()
    : {
        elapsed: performance.now(),
        boot: "web-" + performance.timeOrigin,
        wall: Date.now(),
      };
}
export function advanceClock(a: ClockAnchor, s: ClockSample): ClockAnchor {
  const ok = s.boot !== null && s.boot === a.boot && s.elapsed >= a.elapsed;
  return {
    gameUtc: a.gameUtc + (ok ? s.elapsed - a.elapsed : 0),
    elapsed: s.elapsed,
    boot: s.boot,
    warning: !ok,
  };
}
export function validate(s: GameState): void {
  if (!s || s.schemaVersion !== 1 || s.contentVersion !== "R67")
    throw Error("Unsupported save version");
  const decimal = (x: unknown) =>
    typeof x === "string" && /^(0|[1-9]\d*)$/.test(x);
  const int = (x: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(x) && x >= min && x <= max;
  if (
    !decimal(s.gold) ||
    !decimal(s.tickets) ||
    !decimal(s.capacity) ||
    BigInt(s.capacity) < 100n
  )
    throw Error("Invalid currency/capacity");
  if (
    !int(s.revision) ||
    !int(s.nextId, 1) ||
    !int(s.rosterCapacity, 1, 30) ||
    !s.characters?.length ||
    s.characters.length > s.rosterCapacity
  )
    throw Error("Invalid roster/revision");
  const ids = new Set<string>(),
    characterNames = new Set<string>(),
    party = new Set<number>();
  for (const c of s.characters) {
    const path = content.classPaths.find(
      (p) => p[0] === c.baseClass && p.includes(c.className),
    );
    if (
      ids.has(c.id) ||
      (c.name !== undefined && (typeof c.name !== "string" || !c.name.trim() || characterNames.has(c.name))) ||
      (c.gender !== undefined && !["male", "female"].includes(c.gender)) ||
      !path ||
      !int(c.level, 1, 75) ||
      (c.classLevel !== undefined && !int(c.classLevel, 1, 75)) ||
      (c.classExp !== undefined && !int(c.classExp)) ||
      c.level < [1, 10, 25, 50, 75][path.indexOf(c.className)] ||
      !int(c.exp) ||
      (c.level === 75 && c.exp !== 0) ||
      (c.level < 75 && c.exp >= content.exp[c.level - 1])
    )
      throw Error("Invalid character");
    ids.add(c.id);
    if (c.name) characterNames.add(c.name);
    if (c.party !== null) {
      if (!int(c.party, 0, 3) || party.has(c.party))
        throw Error("Duplicate party slot");
      party.add(c.party);
    }
    if (
      !Array.isArray(c.traits) ||
      c.traits.length > 2 ||
      new Set(c.traits).size !== c.traits.length ||
      c.traits.some(
        (t) => t !== "Primordial" && !traitPool(c.baseClass).includes(t),
      )
    )
      throw Error("Invalid trait");
  }
  const eqids = new Set<string>();
  for (const e of s.equipment) {
    if (
      eqids.has(e.id) ||
      !recipeById[e.templateId] ||
      !int(e.enhancement, 0, 20) ||
      !int(e.rarity, 0, 7) ||
      !content.rarityWeights[recipeById[e.templateId].tier - 1][e.rarity] ||
      (e.owner && !ids.has(e.owner))
    )
      throw Error("Invalid equipment");
    eqids.add(e.id);
    for (const v of Object.values(e.affixes))
      if (!Number.isFinite(v) || v < 0) throw Error("Invalid affix");
  }
  for (const c of s.characters)
    for (const [slot, id] of Object.entries(c.gear)) {
      const e = s.equipment.find((e) => e.id === id);
      if (!e || e.owner !== c.id || recipeById[e.templateId].slot !== slot)
        throw Error("Equipment reference mismatch");
    }
  for (const e of s.equipment)
    if (
      e.owner &&
      !Object.values(s.characters.find((c) => c.id === e.owner)!.gear).includes(
        e.id,
      )
    )
      throw Error("Orphan equipped item");
  for (const bag of [s.materials, s.pending])
    for (const [id, q] of Object.entries(bag))
      if (!materialById[id] || !decimal(q) || BigInt(q) === 0n)
        throw Error("Invalid material");
  if (
    BigInt(
      s.equipment.filter((e) => !e.owner).length +
        Object.keys(s.materials).length,
    ) > BigInt(s.capacity)
  )
    throw Error("Inventory exceeds capacity");
  if (
    s.maps.length !== 10 ||
    !int(s.unlockedMap, 1, 10) ||
    s.quota.wins.length !== 10
  )
    throw Error("Invalid world");
  for (const p of s.maps) {
    if (!decimal(p.wins) || !decimal(p.completed) || !decimal(p.streak))
      throw Error("Invalid progress");
    for (const [id, q] of Object.entries(p.kills))
      if (!enemyById[id] || !decimal(q)) throw Error("Invalid kill counter");
  }
  if (
    s.daily.tasks.length !== 5 ||
    new Set(s.daily.tasks.map((t) => t.id)).size !== 5 ||
    s.daily.tasks.some((t) => {
      const d = content.daily.find((d) => d.id === t.id);
      return (
        !d ||
        (t.target !== undefined && ![5,10,20].includes(t.target)) ||
        !int(t.progress, 0, t.target ?? (s.daily.ruleVersion === 1 ? d.target : d.legacyTarget)) ||
        (t.done && t.progress !== (t.target ?? (s.daily.ruleVersion === 1 ? d.target : d.legacyTarget)))
      );
    })
  )
    throw Error("Invalid daily tasks");
  if (s.daily.claimedMilestones && (new Set(s.daily.claimedMilestones).size !== s.daily.claimedMilestones.length || s.daily.claimedMilestones.some(m => ![1,3,5].includes(m)))) throw Error("Invalid daily rewards");
  for (const name of [
    "combat",
    "encounter",
    "loot",
    "craft",
    "summon",
    "enhance",
    "daily",
  ] as const) {
    const r = s.rng[name];
    if (
      !r ||
      !/^([a-f0-9]{1,16})$/.test(r.state) ||
      !/^([a-f0-9]{1,16})$/.test(r.inc) ||
      !(BigInt("0x" + r.inc) & 1n)
    )
      throw Error("Invalid RNG");
  }
  const expeditionMaps = new Set<number>();
  const expeditionCharacters = new Set(s.characters.filter(c=>c.party!==null).map(c=>c.id));
  if(s.expeditions !== undefined && !Array.isArray(s.expeditions)) throw Error("Invalid expeditions");
  for(const e of s.expeditions ?? []) {
    if(!int(e.map,1,s.unlockedMap) || expeditionMaps.has(e.map) || e.map===(s.battle?.map ?? s.farming) || !Array.isArray(e.partyIds) || e.partyIds.length<1 || e.partyIds.length>4 || !Number.isFinite(e.restUntil) || (e.battle && e.battle.map!==e.map) || (e.farming!==null && e.farming!==e.map)) throw Error("Invalid expedition");
    expeditionMaps.add(e.map);
    for(const id of e.partyIds) {if(!ids.has(id) || expeditionCharacters.has(id)) throw Error("Character assigned to multiple maps");expeditionCharacters.add(id);}
  }
  for (const b of [s.battle,...(s.expeditions ?? []).map(e=>e.battle)]) {
    if(!b) continue;
    if (
      !["normal", "boss", "hidden", "mini", "squirrel"].includes(b.kind) ||
      !int(b.map, 1, 10) ||
      !int(b.round, 1, 30) ||
      b.actors.length > 1000 ||
      new Set(b.actors.map((a) => a.id)).size !== b.actors.length
    )
      throw Error("Invalid battle");
    for (const a of b.actors) {
      if (
        !int(a.hp, 0, a.stats.HP) ||
        Object.values(a.stats).some((n) => !Number.isFinite(n) || n < 0)
      )
        throw Error("Invalid actor stats");
      if (
        (a.kind === "character" && !ids.has(a.id)) ||
        (a.kind === "enemy" &&
          !enemyById[a.templateId] &&
          a.templateId !== "pale_squirrel")
      )
        throw Error("Unknown actor");
    }
    if (b.action && !b.actors.some((a) => a.id === b.action!.actor))
      throw Error("Invalid action actor");
  }
  if (
    s.idle &&
    (!Number.isFinite(s.idle.cutoff) ||
      !Number.isFinite(s.idle.cursor) ||
      typeof s.idle.capped !== "boolean")
  )
    throw Error("Invalid idle cursor");
  const walk = (v: unknown): void => {
    if (typeof v === "number" && !Number.isFinite(v))
      throw Error("Invalid numeric value");
    if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(s);
}
interface Envelope {
  format: "abyss-save";
  schema: 1;
  checksum: string;
  state: GameState;
}
async function hash(text: string): Promise<string> {
  const v = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(v), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function encode(s: GameState): Promise<string> {
  validate(s);
  return JSON.stringify({
    format: "abyss-save",
    schema: 1,
    checksum: await hash(JSON.stringify(s)),
    state: s,
  } satisfies Envelope);
}
export async function decode(text: string): Promise<GameState> {
  if (text.length > 32 * 1024 * 1024) throw Error("Backup exceeds 32 MiB");
  const e = JSON.parse(text) as Envelope;
  if (e.format !== "abyss-save" || e.schema !== 1)
    throw Error("Unknown backup format");
  if ((await hash(JSON.stringify(e.state))) !== e.checksum)
    throw Error("Backup checksum mismatch");
  validate(e.state);
  return e.state;
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("abyss-r67", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("records");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export class Persistence {
  private revision = -1;
  private preserve = false;
  private queue: Promise<void> = Promise.resolve();
  async load(): Promise<{
    state: GameState | null;
    recovered: boolean;
    errors: string[];
  }> {
    let records: string[];
    if (native) {
      const r = await Native.read();
      records = r.records;
      this.revision = r.storageRevision;
    } else {
      const db = await openDB(),
        r = await new Promise<{ records: string[]; revision: number }>(
          (resolve, reject) => {
            const tx = db.transaction("records", "readonly"),
              store = tx.objectStore("records"),
              a = store.get("snapshots"),
              b = store.get("revision");
            tx.oncomplete = () => {
              db.close();
              resolve({ records: a.result ?? [], revision: b.result ?? -1 });
            };
            tx.onerror = () => reject(tx.error);
          },
        );
      records = r.records;
      this.revision = r.revision;
    }
    const errors: string[] = [];
    for (let i = 0; i < records.length; i++)
      try {
        const state = await decode(records[i]);
        this.preserve = i > 0;
        return { state, recovered: i > 0, errors };
      } catch (e) {
        errors.push(String(e));
      }
    if (records.length)
      throw Error(
        "Save recovery needed. Existing data has been preserved. " +
          errors.join("; "),
      );
    return { state: null, recovered: false, errors };
  }
  commit(s: GameState, replace = false): Promise<void> {
    const snapshot = structuredClone(s);
    const run = this.queue.then(async () => {
      const payload = await encode(snapshot);
      if (native)
        await Native.commit({
          payload,
          revision: snapshot.revision,
          expectedRevision: this.revision,
          replace,
          quarantine: this.preserve,
        });
      else {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("records", "readwrite"),
            store = tx.objectStore("records"),
            r = store.get("revision");
          r.onsuccess = () => {
            if (!replace && (r.result ?? -1) !== this.revision) {
              tx.abort();
              return;
            }
            const req = store.get("snapshots");
            req.onsuccess = () => {
              const old: string[] = req.result ?? [];
              if (replace || this.preserve)
                store.put(old, "quarantine-" + Date.now());
              store.put([payload, ...old].slice(0, 4), "snapshots");
              store.put(snapshot.revision, "revision");
            };
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(
              Error(
                "Save conflict or storage failure. Close other tabs and reload.",
              ),
            );
          };
          tx.onerror = () => reject(tx.error);
        });
      }
      this.revision = snapshot.revision;
      this.preserve = false;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
export async function exportBackup(s: GameState): Promise<void> {
  const payload = await encode(s),
    name = "Abyss-Adventure-backup-" + s.revision + ".json";
  if (native) return Native.exportFile({ payload, name });
  const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importBackup(): Promise<GameState> {
  if (native) return decode((await Native.importFile()).payload);
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      try {
        const f = input.files?.[0];
        if (!f) throw Error("Import cancelled");
        resolve(await decode(await f.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => reject(Error("Import cancelled"));
    input.click();
  });
}
