# Visual review checklist (AC23)

Code inspection
- [ ] Every `*.html` links `/src/styles/tokens.css` before `base.css`.
- [ ] No stylesheet except `tokens.css` defines `--c-*` palette values.
- [ ] Tutorial scenes set `data-look="tactical"`.

Manual (desktop Chrome, 1280x720 and 1920x1080)
- [ ] Home, in-game menu, HUD, arena: near-black blue base, cyan primary, magenta secondary.
- [ ] Geometric shapes (hexagons, chevrons, rings), thin emissive outlines, no photo textures.
- [ ] Tutorial: grey concrete with orange markings.
- [ ] Login, profile, rankings, register: same tokens, no off-palette colours.
- [ ] Judgements: Perfect cyan/white, Good yellow, Loose orange, Miss magenta/grey, each with a distinct icon.
- [ ] Placeholder music/art shows a "placeholder" label in game and in the track list.
- [ ] Custom (Beta) is labelled Beta and says it is unranked.
- [ ] Approach ring and targets stay readable over every effect; no clutter.

## Review record - 2026-11-17 (code and screenshot inspection)

- [x] Tutorial scenes set `data-look="tactical"`; every screen switch resets it (`applyLook`, tested).
- [x] All glows derive from `--c-primary` via color-mix; palette test rejects raw cyan rgba literals.
- [x] All seven pages link tokens.css before base.css (tested).
- [x] Placeholder music, home emblem ("Placeholder art" tag, recoloured to cyan) and weapon accent (cyan) are on palette.
- [x] Custom songs show the Beta tag and the "unranked" note; ranked gate rejects custom (tested).
- Not covered: live play feel; re-check in the next creator playtest.
