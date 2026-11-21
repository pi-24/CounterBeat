# Load-time budget (AC19)

## What changed

- Before (baseline commit `656e9fc`): `GameApp.boot()` awaited `audio.load()` for 9 files (menu music + 8 effects, 376 KB of Ogg),
  and the page statically imported the whole 3D engine before anything was shown.
- After:
  1. **Play splash first.** `game-page.js` no longer imports `GameApp` statically. The splash (static HTML) is shown as soon as the
     small page script runs; the engine/game chunk (Babylon, ~295 KB gzip) is imported dynamically behind it. A click made before the
     game is ready enters fullscreen at once (inside the gesture), the button reads "Loading...", and `GameApp.bindStart` honours the
     click the moment it is ready (`early.clicked`).
  2. **Audio streams after the menu.** No sound blocks start-up (`loadStreamed`: menu music first, then other music, then effects);
     menu music starts on arrival (`GameApp.playMenuMusicWhenReady`, triggered from three places).
- Honest limit: streaming here is progressive download off the critical path; Web Audio needs the whole file to decode, so playback
  starts once a file has fully arrived. `streamBytes` only uses the chunk reader when a progress callback is given; otherwise it uses
  `arrayBuffer()` (cheaper).
- Hit-sound gap: effects arrive about 2 s after the menu on Fast 3G; the Play click does not wait for them. They are small and a run
  starts after track selection, so only a very fast player on a slow link could hear a silent first shot. Accepted risk.

## Loading-screen count

The overlay no longer shows a count: nothing blocks start-up, so there is no blocking-asset count to show. In code, the
`onProgress` option and the "Loading audio d/t" writer in `game-page.js`/`GameApp.js` were removed, the dead `CRITICAL_AUDIO` /
`splitManifest` were deleted, and the overlay is hidden as soon as the Play splash is up (static text "Loading CounterBeat..."
only shows for the moments before the page script runs). No code reports a count that disagrees with the real work.

## Measurement (Chrome "Fast 3G" preset, real browser)

`tools/measure-load.mjs` launches headless Chrome, applies the DevTools "Fast 3G" preset via `Network.emulateNetworkConditions` (1.6 Mbit/s x 0.9 down, 562.5 ms latency), disables the cache, serves the build over local http (gzip on text assets) and
reports the median of 5 runs. Two times are reported and kept apart:

- **splash**: navigation start to the static Play splash (NOT the menu).
- **main menu**: the script clicks Play as soon as the splash is clickable (an early click, as a player would), and the time stops
  when the start overlay is hidden and the real menu overlay is shown (`MenuScreen.enter` also sets `performance.mark('cb-menu-ready')`).

The "before" build is `git archive 656e9fc` built with vite (pinned SHA).

| Build | Splash | Real main menu |
|---|---|---|
| Before (656e9fc) | 6.77 s | 6.80 s (runs 6.67 to 7.54) |
| After | 2.48 s | 3.18 s (runs 3.16 to 3.20) |

Main-menu reduction: **53.3%** (AC19 needs >= 50%; the splash alone would be 63%, but that is not reported as menu entry).
Before the `modulepreload` fix the real menu was 3.40 s, a 50.0% reduction: too close, so the `preloadGameApp` plugin in
`vite.config.js` now preloads the GameApp chunk and its static imports from game.html, which removes one network round trip.
The 3D engine and play/result screens load after the menu appears and do not block it; audio streams after the menu.
Re-run: `node tools/measure-load.mjs --compare 656e9fc 5` (builds both), or `npm run build && node tools/measure-load.mjs dist 5`.

### Loading later than the `load` event

Because the engine, the screens and the audio are now fetched *after* the page's `load` event, a tool that
stops serving the build at `load` would cut those requests off (`net::ERR_CONNECTION_REFUSED` in the console).
`markAtlasReady` (`src/game/atlasHook.js`) is the single readiness signal for every load of `game.html`, with or
without `?atlas_scene=`: it sets `window.__atlasReady` only after `ready3d`, `scene.whenReadyAsync()` (Babylon's
shader chunks) and the streamed audio have all settled, each capped so a failure cannot stall it. Measured on the
built output over local http: the last request lands at about 1.2 s and the flag is set at about 2.1 s, so nothing
is in flight when a harness tears the server down. It stays a boolean: no run is submitted and no progress is saved.

# Track and tempo validation (AC20)

`npm run validate:tracks` (also part of `npm test`) checks all 6 tracks: constant BPM (single `bpm`, no tempo map),
numeric offset, licence file in the repo or `placeholder: true`, and tempo drift < 0.5%, measured from the SHIPPED Ogg files:

1. `tools/make-tempo-fixtures.mjs` decodes `public/audio/music-*.ogg` in headless Chrome and stores a small onset-energy fixture per track in `tools/fixtures/tempo`.
2. `tailSeconds` is measured, not chosen: it is the audible end of the decoded audio minus the end of the last bar (`bars` x `beatsPerBar` beats at `bpm`), rounded; `--write-tails` re-derives it. The validator requires the manifest value to match a fresh derivation within 0.15 s, and the length drift |audible end - tail - bars end| / bars end to be under 0.5%.
3. A generator-independent beat-comb fit (`tools/lib/tempo.mjs`) on each half of the audio must agree with the manifest BPM and with each other. `tests/unit/stream-tracks.test.mjs` proves it fails for a time-stretched or mid-track-shifted fixture.
4. The fixture must belong to the shipped Ogg (decoded length within 50 ms of the Ogg header's last granule position).

`npm run validate:release` (`--release`) is the pre-release gate: it fails while any track is a placeholder (all 6 are
today, so it exits 1). The MVP build runs without it. There is no CI pipeline in this repo; wire the release command
into one when it exists.
Placeholder tracks show a "Placeholder music" badge in the track list and "placeholder music" in the in-game HUD title.
