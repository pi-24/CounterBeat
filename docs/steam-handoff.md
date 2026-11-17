# Steam hand-off

What Atlas has prepared locally, and what is still the creator's call. **Nothing has been uploaded, published or paid for.**
The creator owns the Steamworks account and pays the Steam Direct fee.

## Creator decisions still open (Atlas does not decide these)

| Decision | Status | Notes |
|---|---|---|
| **Price** | Open | Paid game (creator decision 2026-11-16). No price is written anywhere in the repo or the drafts. |
| **Release date** | Open | No date is promised in the trailer cut list or store text. |
| **Age rating answers** | Open | Steam's content questionnaire and the IARC rating are answered by the creator. Facts to answer from: you shoot abstract geometric bots, there are no humans, blood or gore; no gambling or purchases in the game; no chat; leaderboards show a display name; Custom (Beta) songs stay on the player's machine. |
| **Final store text** | Open | `docs/store-text-draft.md` is a draft to rewrite. |
| **Music (S5)** | Direction decided: free or royalty-free tracks licensed for commercial game use. Tracks not chosen. | Atlas shortlists, the creator picks by ear. The trailer music follows this choice. |
| **App ID** | Placeholder | `data/steam.json` holds Valve's test App ID 480 until the creator creates the real app. |
| **Capsule art approval** | Open | The art in `store/capsules` is a clean first pass. The creator may commission replacements. |

## Local store assets (all under `store/`, not uploaded)

| Steam slot | File | Size |
|---|---|---|
| Header capsule | `store/capsules/header.png` | 920x430 |
| Small capsule | `store/capsules/capsule-small.png` | 462x174 |
| Main capsule | `store/capsules/capsule-main.png` | 1232x706 |
| Vertical capsule | `store/capsules/capsule-vertical.png` | 748x896 |
| Library capsule | `store/capsules/library-capsule.png` | 600x900 |
| Library hero (no logo) | `store/capsules/library-hero.png` | 3840x1240 |
| Library logo (transparent) | `store/capsules/library-logo.png` | 1280x720 |
| Gameplay screenshots | `store/screenshots/*.png` (7) | 1920x1080 |
| Trailer cut list | `docs/trailer-cutlist.md` | 48 s draft |
| Store text drafts | `docs/store-text-draft.md` | short and long |

Checked by `node tools/check-store-assets.mjs` (exact pixel sizes, PNG format, real transparency on the logo, at least five
screenshots, cut list runtime and short-description length).

## How the assets were made

- **Capsules, hero, logo:** `python tools/asset-tools/gen_store_art.py` (needs Pillow). Drawn from geometric shapes in the
  project palette (`data/themes.json`): neon floor grid, doorway panels, approach rings, hexagons. The wordmark is built from
  line segments, not a font, so there is no font licence to track. No pack material, no AI image, no paid asset. The art is
  covered by `LICENSES/atlas-procedural-art.txt` (CC0, released by the creator 2026-11-17).
- **Screenshots:** `npm run build && node tools/capture-store-shots.mjs`. Runs the Electron shell's own preload and
  `app://` origin over `dist/` in a 1920x1080 window with the atlas hook (`?atlas_scene=`), which keeps progress in memory and
  saves and submits nothing. The stage is sized to the window with the same rule as `.stage:fullscreen`, so the frame is the
  fullscreen play view with no web header. The capture tool fails (it never rescales) if the window is not exactly 1920x1080.
  - The six play shots show a **scripted bot run** of the real play screen (`atlasBotLog`, the same bot the replay-validator
    tests use, played back through the game's own replay path), so score, combo, accuracy, speed arc and judgement popups are
    live. They are Normal-difficulty runs on Neon Alley, Breakneck, Server Vault and Overclock; the results shot (`07-results`)
    is a seeded S-rank state.
  - `atlas_clean=1` (set by the capture window only) hides two things that are wrong on a Steam page: the web "Guest run. Log in
    ..." notice, and the "placeholder music" HUD tag. It changes nothing else and is off by default. **The screenshots therefore
    do not show the placeholder tag even though all six tracks are still placeholders; retake them after S5 anyway.**
- **Gamepad:** the build has controller support (task T20), but the GDD v2 scope lists gamepad as out of scope, so the store text
  draft carries no controller claim until the creator confirms it.
- `npm run check:store` runs the size and format check (also checks every PNG chunk CRC).

## Before upload (creator)

1. Pick and licence the music, then retake screenshots (`node tools/capture-store-shots.mjs`) and the trailer.
2. Replace the App ID in `data/steam.json`, and set up achievements and Auto-Cloud (see `docs/steam-cloud.md`).
3. Decide price and release date, answer the age-rating questionnaire, finalise the store text.
4. Approve the capsule art or replace it.
