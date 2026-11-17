# M8 manual checks (creator-run, Windows + Steam client)

Automated coverage already in `npm test`: Electron smoke (`tests/desktop/smoke.test.mjs`) launches the real Electron app in a SHOWN window with a
throwaway profile and no network at all (Steam forced off), clicks through the Play splash with a real mouse event, and asserts: the splash hint
has no browser "fullscreen" wording, the main menu is the element actually on top (not just in the DOM), no site header / guest banner / footer /
stage bar / side rail / page scroll / log-in wording, starts fullscreen, Alt+Enter toggles windowed and back (polled, real window state), preload
bridge present, Steam-absent fallback, clean exit. `CB_SMOKE_SHOT=<file.png>` saves a screenshot (`docs/desktop-menu.png` is the menu it captured).
The smoke run briefly takes over the screen. Steam init fallback: `steam-init.test.mjs`, `electron-shell.test.mjs`. Replay validation (AC8/AC13):
`tests/unit/m8-integration.test.mjs` drives the real submit-run handler with a fake Supabase and requires the same response and stored row for a web
and a Steam-desktop submission, plus `steam-ticket.test.mjs`. Also cloud merge, gamepad, achievements. On desktop the controls reference lives on the
Pause overlay (the web side rail is hidden). The items below need a real Steam client
or hardware and cannot be automated. Nothing is uploaded or published by these checks.

Prep: `npm ci`, `npm run build`, start the Steam client, then `npm run electron:dev` (put `steam_appid.txt` next to
the Electron binary if launching outside Steam; `data/steam.json` appId 480 is the Spacewar test id until the real one exists).
Optional live smoke: `CB_STEAM_LIVE=1 npm run test:desktop`.

## 1. Window and shell (AC28)
- [ ] App starts fullscreen on the main menu. No address bar, tab strip, site header, guest banner or footer anywhere
      (menu, campaign, play, results, settings).
- [ ] Alt+Enter toggles windowed (1280x720) and back; the Settings windowed toggle does the same and persists after restart.
- [ ] Quit button / Esc flow exits the app cleanly (process gone from Task Manager within ~2 s).

## 2. Steam init and overlay (AC29)
- [ ] With Steam running: console shows no `[steam] disabled` warning; `window.counterbeatDesktop.steam.getStatus()` reports `available:true`.
- [ ] Shift+Tab during a run opens the Steam overlay over gameplay; the game keeps smooth frame pacing, closing the overlay resumes input.
- [ ] With Steam closed: the game still starts, one `[steam] disabled` warning, `available:false`, no achievements.

## 3. Achievements
- [ ] Trigger at least three achievements in play (e.g. first perfect stop, first S rank, first star set); each appears as a
      Steam toast and in the Steam achievement list.
- [ ] Offline (Steam closed) the same actions raise no errors.

## 4. Steam Cloud, two PCs
- [ ] PC A: play, earn a star, quit, wait for the Cloud sync. PC B: launch; the star is there.
- [ ] Change a setting on B, quit. PC A: launch; the setting is there. Ranked scores unaffected throughout.
- [ ] Details: `docs/steam-cloud.md`.

## 5. Gamepad playtest
- [ ] Menu navigation, campaign pick, play (stick strafe, trigger fire, aim), pause and results all work on a pad.
- [ ] Hot-plug and unplug mid-run does not crash or leave a stuck strafe key. Compare with `docs/pad-evidence/`.

## 6. Ranked (Steam identity)
- [ ] A Hard run submitted from the desktop build is accepted (ticket attached); the same run's score is identical to the web build for the same replay.

## Release blocker
- [ ] `data/steam.json` still carries the Spacewar test appId 480. Replace it with the real appId (and re-run sections 2-4 against
      a packaged build, not `electron:dev`) before any Steam upload. AC29 is not closed until this is done.

## Results (fill in per run, one row each)

| Date | Build (commit hash / version) | Result (pass / fail, sections) | Notes |
|---|---|---|---|
| | | | |

Creator sign-off for M8: ______________________
