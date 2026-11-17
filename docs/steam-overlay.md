# Steam init and overlay - manual verification

Config: `data/steam.json` (`appId` 480 is Valve's Spacewar test id until the creator supplies the real one).
`steamworks.js` is loaded lazily in the main process; install it with `npm i steamworks.js` before packaging.
If Steam is not running or the module is missing, the app logs one `[steam] disabled` warning and runs offline.

Manual check (needs Steam client): start Steam, run `npm run electron:dev` (with `steam_appid.txt` next to electron
if launching outside Steam), press Shift+Tab during play. The overlay should open over gameplay.
Without Steam, the game must start normally and `window.counterbeatDesktop.steam.getStatus()` reports `available:false`.

## Status of the real Steam path (AC29)
- `steamworks.js` is declared as an **optionalDependency**; it has NOT been exercised against a real Steam client in this repo yet. The success path is covered only with a fake module; the manual steps above are still required.
- The overlay switches (`in-process-gpu`, `disable-direct-composition`) are applied solely by steamworks.js `electronEnableSteamOverlay()` when Steam initialised (no manual copy). Check frame pacing during the manual run.
- `data/steam.json` is listed in electron-builder `files`. Cloud saves are not implemented (`getStatus().cloud` is always false).

## Packaging native binaries
`electron-builder.json` has `asarUnpack` for `node_modules/steamworks.js/dist/**` (`*.node`, `steam_api64.dll`, `.so`, `.dylib`),
because native modules and the Steam DLL cannot load from inside app.asar. After `npm run electron:build`, confirm
`release/win-unpacked/resources/app.asar.unpacked/node_modules/steamworks.js/dist/win64/` contains the `.node` and `steam_api64.dll`.
Not yet verified by a real packaged build. The overlay over gameplay is NOT verified: steps are Steam running, launch,
Shift+Tab in a run, and confirm the overlay draws and the game stays smooth.

## Smoke
`CB_SMOKE=1` output includes `steam: {available, achievements, warning}`; without a running Steam it must be `available:false` with the `[steam] disabled` warning and `ok:true`.

## Window settings checked for overlay compatibility
`electron/windowConfig.js` / `BrowserWindow` do not disable hardware acceleration (`app.disableHardwareAcceleration()` is never called),
and do not use offscreen rendering or transparent windows. The only overlay switches are the ones steamworks.js adds.
Achievement names accepted over IPC come from the `achievements` list in `data/steam.json`; anything else is rejected.
`npm ci --dry-run` should succeed (lockfile and package.json agree: steamworks.js is an optionalDependency only).

## Quit hang (diagnosed) and release guard
- Cause: `steamworks.js` `init()` starts a never-cleared `setInterval(runCallbacks, 33ms)` and has no teardown API, so with a live Steam client the process outlived `app.exit()`. `electron/main.js` now hard-exits (`quitNow`, `process.exit` after 1 s, preserving `process.exitCode`) on both the quit path and will-quit. The hard exit is acceptable because steamworks.js keeps a 30 Hz interval alive with no teardown API. The live-Steam smoke test runs only with `CB_STEAM_LIVE=1`. The smoke test asserts exit code 0 again and fails on a hang. Not yet exercised against a live Steam client here.
- `CB_STEAM_FORCE_OFF=1` forces the offline fallback; the smoke test runs once with it, so the fallback is asserted on every machine.
- `tests/unit/steam-init.test.mjs` (skipped when the optional dependency or prebuild is missing, mandatory under `CB_RELEASE=1`) loads the real module and native binding and asserts the surface the wrapper calls (init, electronEnableSteamOverlay, localplayer.getName, achievement.activate/isActivated).
- A startup warning is logged while `appIdIsPlaceholder` is true. Run `CB_RELEASE=1 npm test` before packaging: it fails while the App ID is still 480.
- Packaging: `asarUnpack` covers `steamworks.js/dist/**/*.node` and `*.dll` (steam_api64.dll); a unit test checks the globs. A real packaged build is still unverified.
- Overlay over gameplay: NOT verified. Manual: start Steam, launch the game (from Steam or with `steam_appid.txt`), press Shift+Tab during a run, confirm the overlay draws and the game keeps frame pacing.
