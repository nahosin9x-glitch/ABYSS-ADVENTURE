import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { build } from "vite";
for (const preview of [false, true])
  test(`UI boots, transacts and starts battle via ${preview ? "preview native bridge" : "IndexedDB"} (renderer mocked)`, async () => {
    const bundled = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "ui-test-renderer",
          enforce: "pre",
          resolveId(id) {
            if (id === "./arena" || id.endsWith("/apps/game/arena.ts"))
              return "\0mock./arena";
            if (id === "./audio" || id.endsWith("/apps/game/audio.ts"))
              return "\0mock./audio";
          },
          load(id) {
            if (id === "\0mock./arena")
              return "export function showArena(){};export function clearArena(){}";
            if (id === "\0mock./audio")
              return "export function updateAudio(){}";
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        lib: {
          entry: "apps/game/main.ts",
          name: "AbyssTest",
          formats: ["iife"],
        },
      },
    });
    const output = Array.isArray(bundled) ? bundled[0].output : bundled.output;
    const code = output.find((o) => o.type === "chunk").code;
    const dom = new JSDOM('<div id="app"></div>', {
      url: "http://localhost",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const w = dom.window;
    Object.defineProperty(w, "crypto", { value: webcrypto });
    w.indexedDB = new IDBFactory();
    w.structuredClone = structuredClone;
    w.TextEncoder = TextEncoder;
    w.confirm = () => true;
    let nativeCommits = 0;
    if (preview) {
      let records = [],
        revision = -1;
      w.AbyssPreviewNative = {
        call(text) {
          const { id, method, args } = JSON.parse(text);
          let value, error;
          try {
            if (method === "clock")
              value = {
                elapsed: w.performance.now(),
                boot: "preview-test",
                wall: Date.now(),
              };
            else if (method === "read")
              value = { records, storageRevision: revision };
            else if (method === "commit") {
              assert.equal(args.expectedRevision, revision);
              records = [args.payload, ...records].slice(0, 4);
              revision = args.revision;
              nativeCommits++;
            } else throw Error("Unexpected native call: " + method);
          } catch (e) {
            error = String(e);
          }
          queueMicrotask(() =>
            w.__abyssNativeReply(JSON.stringify({ id, value, error })),
          );
        },
      };
    }
    w.eval(code);
    const wait = async (fn) => {
      for (let i = 0; i < 100; i++) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("UI timeout: " + w.document.body.textContent);
    };
    try {
      await wait(
        () =>
          w.document.querySelector("footer") &&
          w.document.querySelector("#app").getAttribute("aria-busy") ===
            "false",
      );
      assert.match(w.document.body.textContent, /Ashwood Forest/);
      assert.equal(w.document.querySelector("header"),null);
      assert.equal(w.document.querySelectorAll(".map-card .map-actions")[0].children.length,2);
      w.document.querySelector('[data-tab="Party"]').click();
      assert.match(w.document.body.textContent, /Warrior/);
      assert.equal(w.document.body.textContent.includes("Slot 1"), false);
      const summon = [...w.document.querySelectorAll("[data-command]")].find(e=>JSON.parse(e.dataset.command).type === "summon");
      assert.equal(summon.textContent, "Summon");
      assert.equal(summon.disabled,false);
      w.document.querySelector("[data-open-roster]").click();
      assert.ok(w.document.querySelector(".roster-sheet"));
      assert.match(w.document.querySelector(".roster-sheet").textContent,/Summon tickets:/);
      assert.match(w.document.querySelector(".roster-sheet").textContent,/Gold/);
      w.document.querySelector("[data-close-roster]").click();
      w.document.querySelector("[data-character-detail]").click();
      assert.match(w.document.body.textContent, /Equipment slots/);
      const skill = w.document.querySelector('[data-skill-index="0"]');
      assert.ok(skill);
      assert.match(skill.textContent, /Main/);
      skill.click();
      assert.match(w.document.querySelector('.skill-sheet').textContent, /MP/);
      assert.match(w.document.querySelector('.skill-sheet').textContent, /180% ATK/);
      w.document.querySelector('[data-close-skill]').click();
      assert.equal(w.document.querySelector('.skill-sheet'), null);
      assert.equal(w.document.querySelectorAll(".gear-slot").length, 6);
      assert.equal(w.document.querySelectorAll("[data-info-gear]").length, 6);
      assert.equal(w.document.body.textContent.includes("No traits"), false);
      w.document.querySelector("[data-close-character]").click();
      w.document.querySelector('[data-tab="World"]').click();
      const firstExplore = [...w.document.querySelectorAll("[data-command]")].find(e => JSON.parse(e.dataset.command).kind === "normal");
      firstExplore.click();
      assert.ok(w.document.querySelector(".expedition-select"));
      const before = Number(w.document.querySelector("footer").textContent.match(/revision (\d+)/)[1]);
      const toggle = w.document.querySelector("[data-toggle-expedition]");
      assert.ok(toggle);
      w.document.querySelector(".expedition-select").scrollTop = 430;
      toggle.click();
      assert.equal(w.document.querySelector(".expedition-select").scrollTop, 430);
      await wait(() => Number(w.document.querySelector("footer").textContent.match(/revision (\d+)/)[1]) > before);
      assert.equal(w.document.querySelector(".expedition-select").scrollTop, 430);
      assert.equal(w.document.querySelector("[data-begin-expedition]").disabled, false);
      w.document.querySelector("[data-toggle-expedition]").click();
      assert.equal(w.document.querySelector("[data-begin-expedition]").disabled, true);
      assert.ok(Number(w.document.querySelector("footer").textContent.match(/revision (\d+)/)[1]) >= before);
      w.document.querySelector("[data-cancel-expedition]").click();
      w.document.querySelector('[data-tab="Inventory"]').click();
      assert.equal(w.document.querySelectorAll(".item-slot").length, 30);
      assert.match(w.document.querySelector(".inventory-gold").textContent,/100 Gold/);
      assert.match(w.document.querySelector(".summon-ticket-slot").textContent,/×1/);
      assert.ok(w.document.querySelector('.summon-ticket-slot img').src.endsWith('/art/currency/summon-ticket.png'));
      const bag = [...w.document.querySelectorAll("[data-command]")].find(e => JSON.parse(e.dataset.command).type === "bag-slot");
      assert.match(bag.textContent, /500 Gold/);
      assert.equal(bag.disabled, true);
      assert.equal(w.document.querySelector("#character"), null);
      w.document.querySelector('[data-tab="Journal"]').click();
      assert.equal(w.document.querySelectorAll(".daily-chest").length,3);
      assert.equal(w.document.querySelectorAll(".daily-chest button:disabled").length,3);
      assert.match(w.document.body.textContent,/500 Gold/);
      assert.match(w.document.body.textContent,/5 Enhancement Stones/);
      w.document.querySelector('[data-journal-tab="Monsters"]').click();
      assert.ok(w.document.querySelectorAll(".unknown-monster").length > 0);
      assert.equal(w.document.querySelectorAll("[data-journal-map] option").length, 10);
      assert.match(w.document.body.textContent,/\?\?\?/);
      const mapSelect = w.document.querySelector("[data-journal-map]");
      mapSelect.focus();
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.equal(w.document.querySelector("[data-journal-map]"),mapSelect);
      mapSelect.value = "2";
      mapSelect.dispatchEvent(new w.Event("change", {bubbles:true}));
      assert.equal(w.document.querySelector("[data-journal-map]").value,"2");
      w.document.querySelector('[data-journal-tab="Bosses"]').click();
      assert.equal(w.document.querySelectorAll(".unknown-monster").length,12);
      assert.equal(w.document.querySelector("[data-journal-map]"),null);
      assert.doesNotMatch(w.document.body.textContent,/Alpha Wolf Fang/);
      w.document.querySelector('[data-journal-tab="Daily"]').click();
      w.document.querySelector('[data-tab="Craft"]').click();
      assert.match(w.document.body.textContent, /The forge/);
      assert.ok(w.document.querySelector(".craft-row .craft-open"));
      assert.equal(w.document.querySelectorAll("[data-craft-tier-select] option").length, 1);
      w.document.querySelector(".craft-open").click();
      assert.ok(w.document.querySelector(".craft-sheet .craft-material img"));
      assert.ok(w.document.querySelector(".craft-sheet .shortage-number"));
      w.document.querySelector("[data-close-recipe]").click();
      w.document.querySelector('[data-tab="World"]').click();
      const explore = [...w.document.querySelectorAll("[data-command]")].find(
        (e) => JSON.parse(e.dataset.command).kind === "normal",
      );
      explore.click();
      assert.ok(w.document.querySelector(".expedition-select"));
      assert.equal(w.document.querySelector("[data-begin-expedition]").disabled, true);
      w.document.querySelector("[data-toggle-expedition]").click();
      w.document.querySelector("[data-begin-expedition]").click();
      await wait(() =>
        w.document.body.textContent.includes("Leave expedition"),
      );
      assert.ok(w.document.querySelector("#arena"));
      assert.ok(w.document.querySelector(".combat-log"));
      w.document.querySelector("[data-back-combat]").click();
      assert.equal(w.document.querySelectorAll("[data-return-combat]").length, 1);
      assert.ok(w.document.querySelector('nav [data-tab="World"]'));
      w.document.querySelector("[data-return-combat]").click();
      assert.ok(w.document.querySelector("#arena"));
      assert.ok(w.document.querySelector('nav [data-tab="World"]'));
      assert.equal(w.document.querySelector(".teams"), null);
      if (preview) {
        assert.ok(nativeCommits >= 2);
        w.dispatchEvent(new w.Event("abyss-native-pause"));
        await wait(
          () =>
            w.document.querySelector("#app").getAttribute("aria-busy") ===
            "false",
        );
        const beforePause = nativeCommits;
        await new Promise((r) => setTimeout(r, 1100));
        assert.equal(
          nativeCommits,
          beforePause,
          "no active tick commits while backgrounded",
        );
        w.dispatchEvent(new w.Event("abyss-native-resume"));
        await wait(
          () =>
            nativeCommits > beforePause &&
            w.document.querySelector("#app").getAttribute("aria-busy") ===
              "false",
        );
      }
      w.dispatchEvent(new w.Event("abyss-native-resume"));
      await wait(() => !w.document.querySelector("#arena") && w.document.querySelector('[data-tab="World"][aria-current="page"]'));
      assert.equal(w.document.querySelectorAll("[data-return-combat]").length,1);
    } finally {
      w.dispatchEvent(new w.Event("abyss-native-pause"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      w.close();
    }
  });
