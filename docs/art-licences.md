# Art licences and build

- Third-party art: Kenney CC0 packs (kenney.nl): Particle Pack (hit spark),
  Prototype Textures (arena floors and walls). Licence texts: `LICENSES/kenney-<pack>.txt`. CC0 needs no
  credit, but CREDITS.md and the in-game Credits screen credit Kenney anyway.
- Everything is recoloured to the palette in `data/themes.json` by `node tools/build-art.mjs --licences`, which
  reads the gitignored `art-src/kenney/` and writes `public/images/` (committed; the game does not need art-src).
- Target bots (PULSE, WOOFER, IRIS, BULLSEYE, PHANTOM, 3 skins each): original Atlas-generated art, CC0, `LICENSES/atlas-bot-sprites.txt`; source drawings `docs/design/bots-source.html`, sheets in `public/images/bots/`.
- Generated art (emblem, code-drawn crosshair shapes): `LICENSES/atlas-procedural-art.txt`, a neutral note stating the art was generated for this project and released CC0 by the creator.
  Confirmed: the creator approved releasing these generated images as CC0 on 2026-11-17 ("Yes, CC0").
- Level thumbnails are composed from the shipped textures by `tools/build-art.mjs`; `themes.json` records a `thumbSource` hash and the validator fails if textures change without a rebuild. Crosshair-pack shapes are not used; crosshairs stay code-drawn.
- `node tools/validate-assets.mjs` fails on images missing from a manifest, unresolved licence paths, off-palette
  or non-PNG images, and a stale CREDITS.md (`node tools/gen-credits.mjs` regenerates it).
- Re-running `tools/build-art.mjs` needs the packs re-downloaded from kenney.nl into `art-src/kenney/` (gitignored): Particle Pack (`particle-pack`) and Prototype Textures (`prototype-textures`). These are the only two packs the tool reads, and both are listed in `data/art.json`. Crosshairs and the emblem are atlas-made (CC0), not from packs. Derivation of the committed PNGs from the packs is not machine-verifiable (art-src/ is not committed).
- Store art (`store/capsules`, from `tools/asset-tools/gen_store_art.py`) is drawn from geometric shapes in the palette with a stroke-built wordmark (no font, no pack, no AI image), so it falls under `LICENSES/atlas-procedural-art.txt`. Store screenshots (`store/screenshots`) are captures of the game itself. See `docs/steam-handoff.md`.
