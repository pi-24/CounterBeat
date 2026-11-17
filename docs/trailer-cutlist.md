# CounterBeat - Steam trailer cut list (draft, 48 s)

Draft for the creator. Nothing here is recorded, uploaded or committed to a voice-over: **no narration**, and no on-screen
text other than the title card and the shots' own HUD. The edit is cut to a **120 BPM grid** (1 beat = 0.5 s, 1 bar = 4 beats
= 2 s), so every cut lands on a beat, which is the game's own promise. Total runtime: **48 s = 96 beats = 24 bars**.

Footage comes from the desktop build (Electron shell, fullscreen, 1920x1080, 60 fps). Clips from other tracks are re-cut onto
the trailer's grid; the trailer music is a separate decision (below), so no clip uses its own track audio.

| # | Time | Beats | Shot | Source | Beat marker / sync point |
|---|---|---|---|---|---|
| 1 | 0:00-0:04 | 1-8 | Black, then one approach ring tightens over a lit doorway. Wordmark (`store/capsules/library-logo.png`) fades in. | Edit graphic + logo | Ring closes on beat 5; logo lands on beat 5; hold to beat 8 |
| 2 | 0:04-0:08 | 9-16 | First person, Neon Alley. Strafe right, tap the opposite key, speed arc turns green, one shot, target shatters, perfect-stop flash. | Gameplay, Neon Alley Normal | Shot fires on beat 13 (the "click" is the first accent of the music) |
| 3 | 0:08-0:12 | 17-24 | Four quick hits in four lanes, one per beat. Hit sounds ring in key, combo counter climbs 1-4. | Gameplay, Neon Alley | One hit per beat, beats 17, 19, 21, 23 |
| 4 | 0:12-0:16 | 25-32 | Close-up of the speed arc and a judgement pop-up: Perfect, Good, Loose, Miss, each with its own icon. This is the "teach by feedback" shot. | Gameplay, slowed to 50% for this shot only | Each pop-up on beats 25, 27, 29, 31 |
| 5 | 0:16-0:20 | 33-40 | Tutorial in the tactical-range look: STEP 1 OF 3 STOP, then Time, then Aim. | Gameplay, Tutorial | Step card swaps on beats 33, 35, 37 |
| 6 | 0:20-0:26 | 41-52 | Three arenas, one bar each: Range, Neon, Vault. Same stop-and-shoot, different room. Then the speed picks up: Breakneck and Overclock lanes switching. | Gameplay, Range / Neon / Vault, then Breakneck Hard and Overclock Hard | Arena cuts on beats 41, 45, 49; lane flurry beats 49-52 |
| 7 | 0:26-0:32 | 53-64 | Dense Hard section: back-to-back stop-and-shoots, combo passes 50, screen stays readable (ring and target win over effects). | Gameplay, Overclock Hard | Hits on every beat 53-64, no cut inside the bar |
| 8 | 0:32-0:38 | 65-76 | Results screen: grade S ring, stars filling, timing-error histogram, "Unlocked: Track" line. Then the campaign menu with the star count. | Results and Campaign menu | S ring lands on beat 65; star 1, 2, 3 on beats 67, 69, 71 |
| 9 | 0:38-0:44 | 77-88 | Quick montage, one beat each: Practice loop readout, Daily, Ranked leaderboard, Settings accessibility (judgement palette, reduced effects). | Menu screens | One screen per beat, beats 77-88 |
| 10 | 0:44-0:48 | 89-96 | End card: main capsule art, wordmark, "[release date and price: creator to supply]". Last ring closes. | `store/capsules/capsule-main.png` | Ring closes on beat 93; hold to the end |

## Notes for the creator

- **Trailer music is not chosen.** The shipped tracks are still placeholders (music decision S5: free or royalty-free tracks
  licensed for commercial game use, shortlisted by Atlas, picked by ear by the creator). The cut list is tempo-agnostic
  apart from the 120 BPM grid, so a track with a different BPM only changes the seconds, not the beat numbers. Re-time the
  Time column if the chosen track is not 120 BPM.
- **Capture method:** record the Electron build with OBS at 1920x1080, 60 fps. Shots 2, 3, 6, 7 can be
  driven by `tools/lib/scripted-player.mjs` for clean, repeatable perfect-stop footage. The store screenshots already use that
  bot: `?atlas_scene=play&atlas_clean=1` shows a scripted run of the real play screen with live score, combo and accuracy.
- **Not committed to:** voice-over, quotes, review scores, price, release date, platform claims beyond Windows desktop.
- **Flash note:** keep the edit under three flashes per second (the game's own reduced-effects cap) when cutting, and check the
  final render for it. Shot 4 and the end card should hold no flashes at all.
