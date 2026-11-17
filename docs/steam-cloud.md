# Steam Cloud saves

The game writes one file, `counterbeat-save.json`, at `%APPDATA%/CounterBeat/counterbeat-save.json`
(`electron/saveIo.js`, atomic temp+rename; `src/progress/SaveFile.js` builds it,
booted by `src/progress/cloudSave.js` before any screen reads settings). Writes
are coalesced (500 ms trailing, plus flush on blur/hide). The calibration offset is in
`settings` (`audioOffset`), the calibrated flag in `progress`. Deleted keys are
tombstoned. Legacy local keys without a timestamp are stamped at first sync so a
remote save cannot overwrite them. It holds settings, calibration/onboarding,
stars and unlocks (`progress`) and local personal bests (`localBests:*`), each
key with its own timestamp. Ranked scores, replay logs, accounts and
leaderboard data are never written to it.

## Conflict rule (`src/progress/mergeSave.js`)
Per key the newer timestamp wins and the whole value is taken (no field
merging). Equal timestamps: local wins. A key on one side only is kept. A
corrupt or wrong-version remote file is ignored and local is kept.

## Steamworks hand-off (creator, in the Steamworks partner site)
App Admin > Steam Cloud > Auto-Cloud (settings mirrored in `data/steam.json`
under `cloud`):
- Root: `WinAppDataRoaming`, subdirectory `CounterBeat` (set explicitly in
  `electron/saveIo.js`, not derived from userData).
- Pattern: `counterbeat-save.json`, no recursion, platform: Windows.
- Quota: 1 MB, 1 file. Enable Cloud for the app, then Publish the changes.
- Nothing is published without the creator's approval.

## Manual two-PC check
1. PC A: play, earn a star, quit (wait for the Steam Cloud sync).
2. PC B: launch; the star appears. Change a setting on B, quit.
3. PC A: launch; the setting appears. Ranked scores are unaffected throughout.

## Clock skew
Ordering uses `Date.now()` on each PC; skew between PCs is accepted. Worst case the
PC with the slower clock loses that key only.
