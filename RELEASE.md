# Abyss Adventure 1.0.1

Official offline Android release, R67 content.
Starting resources: 100 Gold and 1 Summon Ticket; battle EXP multiplier ×1.
Existing saves are retained without resource grants or resets.
Android versionCode 37, debug disabled, same signing identity as v35.
57 automated checks passed; APK v2 signature and payload verified.

Source layout:
- apps/game: game UI, combat presentation and audio
- packages: core engines, content, economy, combat, persistence
- public/art: static pixel art assets
- tests: simulation, persistence and UI checks
- scripts/repack_from_previous.py: package assets using previous APK
- scripts/sign_repacked_apk.mjs: sign using external recovery keys

Build: npm ci; npm test; npm run build; python3 scripts/repack_from_previous.py; node scripts/sign_repacked_apk.mjs.
Signing keys are excluded. No source archive is bundled in the public APK.

Android installer, application and launcher labels verified as Abyss Adventure.
