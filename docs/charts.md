# Charts

`charts/<track>/<difficulty>.json` holds the versioned Hard and Expert charts
(`format`, `chartId`, `chartVersion`, `contentHash`, `bpm`, `bars`,
`firstNoteBar`, `lanes`, `notes`). `src/game/charts/chartLoader.js` is the one
loader used by the client and (as a byte-identical copy under
`supabase/functions/_shared`) the edge function. The hash covers parsed values,
so formatting never matters. A mismatched hash or an old `chartVersion` makes
the chart unresolvable and the server rejects the score.

Tools: `node tools/chart-hash.mjs --verify` (also run by `npm test`) and
`--rehash` after any edit.

## How the current charts were made (honest status)

The six tracks are generated placeholders, so there is no real audio to
hand-author against. The current Hard/Expert charts are **curated generator
output**: `tools/author-charts.mjs` realises a per-track section plan (intro,
verse, build, drop, break, final) with rhythm figures and lane motifs, enforces
strafe feasibility from the movement model, and re-rolls seeds until the
musical-quality checks in `tools/lib/chart-quality.mjs` pass:

- no more than 4 consecutive same-lane notes closer than the 320 ms counter-strafe window;
- no single rhythm figure fills more than 35% of the bars;
- every lane carries at least 8% of the notes;
- no more than 6 consecutive notes in one lane;
- no bar (rhythm + lanes) repeated more than twice in a row;
- no 4-bar phrase followed by an identical 4-bar phrase;
- Expert at least 3.2 notes/s, Hard within +-10% of 2.4 (at least 2.4).

These run in `tools/chart-stats.mjs` and `tests/unit/chart-version.test.mjs`.
All notes sit on the 1/4-beat grid (a test asserts it). The earlier "off-grid
1/8" finding was a misreading: odd 1/4-beat slots (1/16 notes) are on-grid;
only values not multiples of 0.25 would be off-grid and none exist.

**chartVersion semantics.** The number is bumped whenever a chart's notes
change (the authoring script bumps it on each regeneration), so unequal
numbers across charts only record how often each was regenerated. A bump
retires older scores and replays for that chart.

**Honest status.** These are curated generator output, not note-by-note
hand-authoring. Same-lane bursts are capped (above), so every long burst needs a
lane change and a stop.

## Follow-up (deferred)

True hand-authoring against the audio (phrase boundaries, accents, drops)
waits until the creator approves real licensed tracks. When a placeholder
track is replaced: re-author its section plan against the real audio, rerun
`node tools/author-charts.mjs` (or edit the JSON by hand), run
`node tools/chart-hash.mjs --rehash`, and bump the chart version so old
scores and replays are retired.
