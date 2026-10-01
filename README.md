# Abyss Adventure

Official version 1.0.1. Offline dark fantasy RPG for Android.

## Source layout

| Path | Purpose |
|---|---|
| apps/game/ | UI, combat presentation, art lookup and audio |
| packages/core/ | State, commands and random streams |
| packages/characters/ | Classes, traits, EXP and equipment stats |
| packages/combat/ | Battle simulation |
| packages/economy/ | Crafting, inventory, upgrades and prices |
| packages/world/ | Maps, independent expeditions, rewards and quests |
| packages/platform/ | Validation, save/load and native bridge |
| packages/content/data.json | Current R67 game database |
| public/art/ | All static game art |
| android-preview/ | Actual Java Android shell used by the APK |
| scripts/ | Packaging, signing, audits and legacy import tools |
| tests/ | Automated tests |
| docs/PUSH-GITHUB-ANDROID.md | Detailed Vietnamese phone guide |

## Web development

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:5173 in the browser while the dev server runs. Typecheck: `npm run typecheck`.

## Current release

New journey: 100 Gold, 1 Summon Ticket, normal EXP. No test grant or update reset.
Android application label: Abyss Adventure; versionCode 37.
Native installed package: `com.nah.abyssadventure.preview`, retained for update compatibility.
`capacitor.config.ts` is configuration for an alternative Capacitor wrapper; it is not the wrapper used in the shipped APK.

## Android build

The actual shell is in android-preview. Requires a JDK, Android SDK build tools and android.jar.

```sh
npm ci
npm run build
export ABYSS_BUILD_TOOLS=/path/to/android-sdk/build-tools/35.0.0
export ABYSS_ANDROID_JAR=/path/to/android-sdk/platforms/android-35/android.jar
export ABYSS_UNSIGNED_APK="$PWD/android-preview/build/Abyss-Adventure-unsigned.apk"
python3 scripts/build_preview_apk.py
export ABYSS_SIGNING_KEY=/private/path/signing.key.pem
export ABYSS_SIGNING_CERT=/private/path/signing.cert.pem
export ABYSS_APK_OUTPUT="$PWD/android-preview/build/Abyss-Adventure-1.0.1.apk"
node scripts/sign_repacked_apk.mjs
```

Signing keys are deliberately not included. Matching the existing APK signature requires the original private signing identity. Store keys separately, never in Git.
`repack_from_previous.py` is a recovery workflow requiring the previous v35 APK outside this source tree.
The legacy `npm run android:*` commands target Capacitor and require a generated android directory.
The optional `npm run content` importer requires the original roadmap document under docs; current data.json is sufficient for tests and builds and must not be overwritten with old design data.

## GitHub

Follow docs/PUSH-GITHUB-ANDROID.md. Push the extracted files, not this ZIP. Keep the source repository private unless you intentionally want to disclose all game code and art. Share the signed APK through a Release asset.
