# Technical notes

Working notes on why the game is built the way it is. These are the decisions
worth being able to defend, with the numbers behind them.

---

## 1. The movement model

`js/game/CounterStrafeBody.js` is a plain class with no engine code in it. It models
three behaviours:

| Input | Acceleration applied |
| --- | --- |
| Holding a direction | `accel` towards `maxSpeed` |
| Nothing held | `friction` against the current velocity |
| The *opposite* direction while still moving | `counterDecel` |

`counterDecel` is roughly five to six times `friction`, which is what makes the
counter-strafe worth learning:

| Level | maxSpeed | accel | counterDecel | friction | Stop by counter-strafe | Stop by releasing |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Warehouse | 340 | 3000 | 4600 | 820 | 74 ms | 415 ms |
| 2 Neon Alley | 500 | 4800 | 7000 | 1190 | 71 ms | 420 ms |
| 3 Server Vault | 680 | 7000 | 9500 | 1620 | 72 ms | 420 ms |

Units are abstract track units (0–1024 across the arena) and track units per
second; `WORLD.metresPerUnit` converts them to metres for the 3D scene, so
the whole 832-unit track is about ten metres wide.

Two details make it behave like the real thing rather than like a brake:

- **The stop is exact.** On the frame where the counter-strafe would push the
  velocity through zero, it is pinned to zero instead. A correctly timed tap
  therefore produces a genuine dead stop rather than an almost-stop.
- **Overholding is punished by the model, not by a rule.** Once the velocity is
  zero the input is no longer "opposing", so the next frame uses the ordinary
  `accel` and the player starts moving the other way. Holding the tap 30 ms too
  long at level 3 leaves you moving at over 200 u/s — out of the lane.

Releasing is forgiving in one narrow way: below `STOP_SPEED` (18 u/s) with no
key held, the velocity snaps to zero. That is what makes "tap slightly early,
then release" a reliable technique rather than a coin flip, and it mirrors the
stop-speed term in the source engines this is modelled on.

---

## 2. Charts are generated, and checked against the physics

`js/game/BeatMap.js` builds each level's notes from a seeded `xorshift32`
generator, so a level is byte-for-byte identical every time it is played and
scores are comparable, without hand-authoring 216 notes.

The part worth pointing at is `chooseLane`. Before placing a note it asks the
movement model a question:

```js
const reach = CounterStrafeBody.maxDistance(this.level.movement, availableSeconds);
```

`maxDistance` solves the trapezoidal (or, for very short gaps, triangular)
velocity profile for a body that starts and ends at a dead stop:

```
tAccel = maxSpeed / accel
tStop  = maxSpeed / counterDecel

t >= tAccel + tStop:  d = maxSpeed²/(2·accel) + maxSpeed²/(2·counterDecel)
                          + maxSpeed·(t − tAccel − tStop)
otherwise:            v = t / (1/accel + 1/counterDecel)
                      d = v²/(2·accel) + v²/(2·counterDecel)
```

Only lanes within `reach` are candidates, and a different lane is always
preferred over the current one, so the chart forces movement without ever asking
for a dash that cannot be made. The available time is discounted to 80% of the
real gap to leave room for reaction, since the lane only lights up two beats
ahead.

When no other lane is reachable — the 200 ms doubles on level 3 — the note stays
in the current lane and reads as a rhythmic double rather than an impossible
demand. That is why level 3's lane-change rate is 33% while level 1's is 98%.

---

## 3. Difficulty is four independent dials

Rather than "make it faster", each level changes four things:

| | L1 | L2 | L3 |
| --- | --- | --- | --- |
| Tempo | 90 BPM | 120 BPM | 150 BPM |
| Notes per bar | 2 | 4 | 6 |
| Lanes | 3 | 4 | 5 |
| `trackScale` (width the lanes occupy) | 1.00 | 0.88 | 0.70 |
| `laneInset` (fraction of a slot that counts as inside) | 0.60 | 0.55 | 0.50 |
| Perfect timing window | ±55 ms | ±45 ms | ±38 ms |

`trackScale` is the interesting one. More lanes on the same width would make the
gaps between them *longer*, so a five-lane level at 150 BPM would be physically
impossible. Squeezing five lanes into 70% of the track instead makes each hop
shorter *and* each stopping zone narrower — harder in the way that matters
(precision) rather than harder in the way that is just unfair (reach).

---

## 4. Timing comes from the audio clock, not the frame clock

The game owns its audio.  `js/game/audio/AudioEngine.js` is a thin layer over
the Web Audio API: it decodes the tracks, schedules the level music to start
at an exact `AudioContext.currentTime`, and exposes `musicPosition` as
`currentTime − startedAt`.  `Conductor.js` reads that one number.

Accumulating the render loop's frame delta would have been the obvious approach
and it is wrong: a dropped frame or a browser throttle would drift the judgement
away from the music permanently, and by level 3 the whole perfect window is
38 ms.  Every visible thing — the approach rings, the beat pulse around the
crosshair, the countdown, the judgement — is derived from that one number, so
the picture and the music cannot disagree.

Pausing is `AudioContext.suspend()`, which freezes the clock itself, so the
Conductor never has to special-case a pause.

---

## 5. Grading takes the worst of three, after the ray has to land

`js/game/Judge.js` grades a shot three times and takes the lowest:

- **Timing** — from `|songTime − note.time|` against the level's windows.
- **Velocity** — 20 / 65 / 140 u/s for Perfect / Good / Loose. Faster than that
  and the shot sprays; it is a miss regardless of how well timed it was.
- **Aim** — the hit-scan ray has to reach the bot.  If it hit the window wall
  first the reason is "Blocked — wrong window"; if it reached the backstop it
  is "Missed the bot".  A head hit sets `headshot`, worth 1.25×.

Being perfectly on the beat cannot rescue a shot fired at a sprint, which is the
whole point of the design.

The counter-strafe bonus is not a fourth grade: `isPlanted()` asks whether a
counter-strafe was active within the last 320 ms. Releasing the key can never
satisfy that, so the 1.5× only goes to a deliberate stop.

---

## 6. Accuracy is weighted, not a hit rate

A plain hit rate would score a run of scraped notes identically to a clean one.
`Scorer.accuracy` weights Perfect 1, Good 0.75 and Loose 0.34, which is what the
rank letter and the level-unlock threshold are measured against.

The focus bar is the fail condition: −8 per miss, −3 per wild shot, +3 per
perfect. Thirteen unanswered misses ends a run, which is forgiving enough to
learn on and tight enough that a level cannot be brute-forced.

---

## 7. Where the data lives

Two local-storage keys, both JSON, both owned by exactly one class:

- `counterbeat:users` — `UserRepository`. One record per account, with a random
  16-byte salt and a SHA-256 hash of `salt:password` rather than the password
  itself. This is a client-side project, so the hash sits next to the data it
  protects — it is there because storing readable passwords would be worse, not
  because the browser is a safe place for secrets.
- `counterbeat:scores` — `ScoreRepository`. One record per completed run,
  capped at the most recent 500 so a long session cannot fill the quota. The
  rankings page derives each player's best run from this list rather than
  keeping a second, duplicated table that could fall out of sync.

`counterbeat:session` holds only a user id, so logging out never touches the
account records.

`Storage` is the only class that calls `localStorage` directly. It catches
`JSON.parse` failures, drops the corrupt entry and returns the caller's fallback
— a bad entry degrades one feature instead of throwing on page load.

---

## 8. The game does not know the website exists

The scenes never import a repository. `createGame` is handed a `services`
object, and the scenes only ever ask it:

```js
getPlayerName()  isLoggedIn()  getUnlockedLevel()
getPersonalBest(levelId)  onRunComplete(record)  onJudgement(judgement)
```

`js/pages/game-page.js` implements those against the repositories. That is why
guest play works without a single conditional inside the game: the page simply
supplies a services object that keeps scores in a `Map` for the session instead
of writing them.

The engine is kept at arm's length the same way.  Babylon.js appears only in
`fps/`, `screens/` and `GameApp.js`; the five rules classes — `BeatMap`,
`CounterStrafeBody`, `Conductor`, `Judge`, `Scorer` — never import it, which is
why the simulator can run them in Node with no browser at all.

---

## 8a. The window wall is the lane rule, made physical

The 2D version told the player "stand inside the lit lane".  The 3D version
builds a wall at `WORLD.wallZ` with one open window per lane and stands the bot
at `WORLD.targetZ` behind it.  From in front of the window the bot is visible;
from anywhere else the hit-scan ray hits the wall.  Nothing has to be explained.

The window is sized so the two agree.  A ray from the player at lateral offset
`d` from the lane centre crosses the wall plane at `d · (1 − wallZ / targetZ)`
from the window centre, so the window's half-width is the lane's half-zone
(in metres) scaled by that factor — 0.648 with the wall at 4.4 m and the bots
at 12.5 m.  Standing inside the zone gives line of sight; standing outside does
not.

Later levels squeeze more lanes into a narrower strip (`trackScale`) *and*
shrink the zones (`laneInset`), so the windows get narrower twice over.

## 8b. Running inaccuracy is a real spread cone

`PlayScreen.buildShotRay` pushes the ray off the crosshair by a random angle:

```
cone = 0.12° + 7.5° · (speed / maxSpeed)^1.2
```

The offset is drawn uniformly over the disc of that cone, and the ray is
`forward + right·tan(r)·cos θ + up·tan(r)·sin θ`.  Standing still the cone is a
tenth of a degree — a laser.  At a sprint it is wider than the bot, which at
12.5 m subtends about 6.5° of height and 3° of width.  The velocity grade in
`Judge` still applies on top, so a lucky moving hit is scored Loose rather than
Perfect.

## 8c. Bots are sprites, and the hitbox is tighter than the quad

The bots are billboard sprites from `images/bot-sheet.png` via Babylon's
`SpriteManager` — idle breathing, a white flash on the hit, and a collapse for
the death.  Ray picking against a sprite tests its whole quad, which is wider
than the bot drawn on it, so `TargetField.zoneFor` confirms the hit against a
body box (±0.46 m, 4 %–76 % of height) and a head circle (0.22 m radius at
84 % of height), measured in the bot's billboard plane.  A shot through the gap
under the arm is a miss, and a head hit is a head hit.

Notes that share a lane queue behind one another at 0.8 m intervals, and a
shot that lands on any bot in a lane is always credited to the *earliest*
unresolved note in that lane, so a double is judged in order.

## 8d. Mouse input the way the audience expects

`FpsCamera` requests pointer lock with `unadjustedMovement: true` — raw input,
no operating-system acceleration — and turns each mouse count into
`sensitivity × 0.022°` of yaw, which is Counter-Strike's `m_yaw`.  The settings
panel shows the Valorant equivalent (÷ 3.18) and the cm/360 derived from the
player's DPI, because that is the number they already know for their own setup.
Field of view is horizontal-fixed, Valorant's convention, so 103° means the
same thing it does there.

Losing pointer lock — <kbd>Esc</kbd>, alt-tab, the browser taking it away — is
the pause signal; the game never has to guess.

## 8e. The HUD never writes an inline style

The brief awards zero marks for CSS written as `style` attributes.  The HUD is
HTML and SVG, and every value that changes per frame is written as an SVG
attribute (`x`, `width`, `r`, `opacity`, `stroke`), a class, or a text node.
The crosshair is four `<line>`s whose coordinates come from the settings; the
velocity meter, focus bar and lane strip are rectangles whose attributes move.

## 8f. The note highway and the tutorial

The lane strip told the player *where* the next window was; it did not say
*when*.  The note highway above it is a four-beat lookahead: each upcoming bot
is a dot descending its lane's column, with dashed beat lines scrolling with
the music, and it lands on the lane strip exactly on the beat.  It is the same
information as the approach ring, but it is readable for the next three or
four notes at once rather than one at a time.

The tutorial is a level with `tutorial: true`: 90 BPM, one bot every bar, a
thirteen-second practice intro, generous windows, no fail state, not ranked.
`PlayScreen.updateTutorial` shows one instruction at a time and clears each
one when the player actually does it - moves, then plants a counter-strafe,
then takes a shot - so nobody reads about the technique without performing it.

## 9. Things that went wrong, and the fixes

**The charts were impossible at level 3.** The first version used a fixed track
width for every level, so five lanes meant 166 px hops, and the simulator showed
a perfect player missing 34 of 216 notes. `trackScale` fixed it: narrowing the
strip shortened the hops to 120 px and took the perfect player to 100%, while
`laneInset` kept the difficulty by shrinking the zones.

**Counter-strafing was optional.** With the original friction values, releasing
the key stopped you in 155 ms, which was fast enough to survive every level. The
release-only simulation exposed this — both pilots scored identically. Dropping
friction to about a 420 ms slide separated them: 100% versus 64.5% at level 3.

**Modules do not load over `file://`.** ES modules are required for the marking
criteria, and they are blocked on the file protocol by CORS. The game page
detects a failed boot and says so on screen rather than showing a blank panel,
and the README leads with the local-server instruction.

**The first 3D build was claustrophobic.** With the window wall 2.6 m from the
player it filled the view and one pillar could hide everything.  Moving it to
4.4 m, lowering it to 2.9 m and bringing the bots in to 12.5 m gave an
aim-trainer sightline; the window formula kept the rule identical.

**The approach ring vanished.** A torus lies flat by default and
billboarding kept it edge-on, so only a line was visible; tipping it to face
the corridor fixed that, and then it was still mostly hidden *behind the wall*
because it was wider than the window.  It now closes from 1.25 m to the size of
the chest ring rather than from 3.4 m.

**Two bots in one lane drew on top of each other,** and a shot could be
credited to the later note.  Same-lane notes now queue in depth and a hit is
always credited to the earliest unresolved note in that lane.

**The second bot of a double could never be hit.** Two notes 250 ms apart in
one lane queue the bots front and back.  Shooting the front one started its
death animation but left its sprite pickable, so the next shot's ray stopped
at the dying bot, found no unresolved note behind it, and reported "Missed the
bot".  A judged bot now has `isPickable = false`, and a deterministic test
spawns two bots in a lane, kills the first and confirms the ray reaches the
second.

**Shooting after the last bot could fail a cleared run.** Every stray click
used to cost focus.  A shot with no live bot on screen - before the first one
or after the last - is now free, and the run ends 1.2 s after the final note
resolves rather than when the track runs out.  Shooting a bot long before its
beat no longer consumes the note either: it flinches, the combo breaks, and
the beat is still there to hit.

**SVG elements have a read-only `className`.** The hitmarker's class is set
with `setAttribute('class', …)`; the first version threw on the first hit.

---

## 10. What is not finished

- Mobile has no touch controls. The layout is responsive and the pages work, but
  the game needs a keyboard, a mouse and pointer lock.
- The simulator models the grading, not the spread cone or the aim, so it is a
  lower bound on how much harder a moving shot is in the real game.
- There is no audio-offset calibration. The Web Audio clock is accurate, but a
  player on Bluetooth headphones will hear the beat late and cannot compensate.
- Scores are per-browser by definition, since the brief rules out a server.
