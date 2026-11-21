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

## Review record - 2026-11-18 (T30 design consistency pass, direction C)

Automated (`node tools/check-design-consistency.mjs`, run by `npm test`, unit-tested in `tests/unit/design-consistency.test.mjs`)
- [x] No hex / rgb / hsl / named colour in any CSS, `<style>`, `style=` attribute, SVG presentation attribute or script style string outside `tokens.css` (3D scene constants in `src/game/fps`, `src/ui/palette.js` mirror and the rules data default are exempt).
- [x] Every `font-family` is `var(--display)`, `var(--body)` or `var(--mono)`; the old `--font-*` aliases are gone.
- [x] All seven html pages load `tokens.css` before `base.css`.

Screen walk (reference `docs/design/ui-direction-c.html` frames 01-04; captures in `docs/design/t30`)
- [x] Menu, song select, settings, pause, help, home, login, rankings, profile: thick paper rules, flat fills, acid focus slab.
- [x] Focus: one flat ring everywhere (3px acid, 3px offset). The pad-focus rule lost its 14px glow so pad and keyboard look the same.
- [x] Prompt bar: pause, help, results and calibration overlays now carry the same bottom bar as the menus (keys and pad glyphs, both sets in the markup, active set follows the last device).
- [x] Key chips inside buttons follow the button colour (they were paper-on-acid and paper-on-paper, unreadable on focus / hover).
- [x] Settings: the judgement-palette select, DPI field and colour field share one ink / 3px paper style (the select was a native white control); the crosshair SVGs use `currentColor` from a token instead of a hard-coded hex.
- [x] Judgement shapes are one component (`.shape--perfect|good|loose|miss`) in the HUD, results histogram and settings legend.
- [ ] Manual, next playtest: results, calibration, tutorial, shop and credits on a 1920x1080 display and with a pad; reduced-effects on.
