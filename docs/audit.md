# CounterBeat - M0 audit

Scope: repo inspection (rules, scene/screens code, AudioEngine, server rules, tests) plus the creator's M0 playtest (`docs/playtest-m0.md`). No game behaviour was changed in this task (only the test harness, test scripts and docs). Findings from code are from reading, not from a profiled browser session; items marked (unverified) need measuring in a browser.

## What exists

- **Rules** (`src/game/rules/*`): engine-free, deterministic; shared by client, edge function (`tools/sync-rules.mjs`) and simulator. Config in `config.js`, difficulties and chart generation in `charts.js`.
- **Scene / screens** (`src/game/GameApp.js`, `fps/*`, `screens/*`): Babylon.js arena, targets, HUD, viewmodel; PlayScreen (~770 lines) holds most of the run flow. Fullscreen is a toggle button in `GameApp`, not an automatic part of Play.
- **AudioEngine** (`audio/AudioEngine.js`): Web Audio, `latencyHint: 'interactive'`, smoothed clock derived from `context.currentTime`, music and SFX loaded with `fetch` + decode up front (not streamed). Music start is scheduled 50 ms ahead.
- **Server**: replay-based validation of input logs against rules; only the server score is ranked. All four difficulties are submittable today.
- **Tests**: `tools/test-validate.mjs` (replay validator and cheats), `tools/test-analyse.mjs` (beat detector; needs WAVs), and now `tests/unit` (`node --test`). No UI, rendering, audio-timing or input tests.

## Gaps against the GDD (code-level)

| Area | Now | GDD |
|---|---|---|
| Notes/s | easy 0.9, normal 2.2, hard 2.4, expert 2.6 | ~0.95 / ~1.6 / ~2.4 / 3.2+ (normal too dense, hard and expert barely separated) |
| Pass accuracy | 50 / 58 / 64 / 70 % | Normal 50% |
| Grades | perfect / good / ok / miss | Perfect / Good / Loose / Miss (rename) |
| Aim scale per difficulty | none in config (SPREAD global) | hitbox and spread scale per tier in `rules.json` |
| Fail-out | per difficulty | Campaign never fails (D1) |
| Manifests, chart hash/version | none; charts built in code | JSON manifests, versioned charts with hash |
| Stars, cosmetics, practice, ranked Hard/Expert only | absent | required |
| Fullscreen + in-game pointer-lock prompt | button toggle | automatic from Play (AC1) |
| Audio loading | full preload | streamed |
| Test URL `?atlas_scene=` | not implemented | requested by the harness (later task) |

## Ranked feel problems

Ranked by the creator's priority signal (their words) first, then code-read risks.

1. **"Janky/jittery and it's a website"** (creator, worst problem). Causes to check (unverified): render-loop frame pacing vs audio clock, camera/viewmodel updates tied to variable dt, page chrome around the canvas, fullscreen only by button. Fix direction: fullscreen + pointer lock from Play (M3), fixed-step or smoothed visual time, measure frame times (M2).
2. **Design looks basic / not professional** (creator: fonts, layout, "a little basic"). Fix: palette tokens, typography, menu rework (M3, M5). Keep clutter low (creator).
3. **Slow, possibly hung loading** (earlier screenshot stuck on "Loading audio 7/9"; creator found loading fine). Fix: stream music, fewer blocking decodes (M5).
4. **Difficulty spacing**: Normal 2.2 nps is much denser than the GDD, Hard/Expert are only 0.2 apart. Fix in M4.
5. **Feedback is thin** beyond the hit sound (creator: movement and shooting satisfying, hit sound is the best moment). Add pulse, shatter, flash, speed arc (M2) while keeping targets/ring dominant.
6. **No post-run learning tool** (timing histogram, stop stats) to support the "get better" loop (M4).
7. **Clean-clone blind spot**: beat detector tests silently had nothing to run; now they report an explicit SKIP.

What works and must not regress (creator): counter-strafe movement, timing, aim feel, difficulty differences, readability.

## Starting tuning values (D3, retune after M7)

- Star gates for tracks 2 to 6: 3 / 8 / 14 / 21 / 28.
- A-rank accuracy 85%.
- Stop-quality challenge: 80% of shots on a Perfect or Good stop.
- Stop speed thresholds 20 / 65 / 140 (already in `SPEED_GRADE`); counter-strafe credit 320 ms.
- Density targets: Easy 0.95, Normal 1.6, Hard 2.4, Expert 3.2 notes/s.
- Hit-stop 30 to 50 ms, cosmetic only.
