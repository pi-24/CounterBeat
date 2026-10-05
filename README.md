# CounterBeat

A first-person browser rhythm game built around **counter-strafing** — the
movement technique from tactical shooters where you cancel your momentum by
tapping the opposite movement key, because your shots are only accurate while
you are standing still.

A bot steps out behind one of the windows in the wall. You strafe in front of
that window, tap the opposite key to stop dead, put your crosshair on the bot
and fire on the beat. Every shot has to satisfy four things at once:

| | What it means |
| --- | --- |
| **Position** | You need line of sight through the lit window. From anywhere else, the shot hits the wall. |
| **Velocity** | Your shot spreads with speed — a laser standing still, seven degrees wide at a sprint. Only a counter-strafe stops you fast enough. |
| **Timing** | The shot must land inside the level's window around the beat. |
| **Aim** | The ray has to reach the bot. Head hits pay 1.25×. |

Stopping with a counter-strafe rather than by releasing the key earns a 1.5×
bonus on that note, and from level 2 onwards the gaps between notes are short
enough that releasing simply does not stop you in time.

There is a tutorial that walks through the strafe, the counter-strafe and the
first shot one instruction at a time, a note highway at the bottom of the HUD
that shows which window is next and exactly when, and three levels that get
faster and tighter.

Built for people who already play CS and Valorant: pointer-locked raw mouse
input, sensitivity entered the Counter-Strike way with the Valorant equivalent
and cm/360 shown beside it, adjustable field of view, a customisable crosshair,
hitmarkers, a recoil kick, and a velocity readout.

---

## Running it

The site uses **ES modules** (`<script type="module">`) and **WebGL**. Browsers
refuse to load modules over `file://`, so **open it through a local web
server** — double clicking `index.html` will show a blank game panel.

Any of these work:

```bash
# Python (already installed on macOS and most Linux machines)
cd website
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

```bash
# Node
cd website
npx serve .
```

Or, in VS Code, right-click `website/index.html` → **Open with Live Server**.

Tested in Chrome. Click the arena to capture the mouse; <kbd>Esc</kbd> releases
it and pauses. The first click also unlocks audio.

### Optional: a global rankings table

Accounts and scores live in local storage, as the brief requires, so the
rankings page shows the players of one browser. For the public deployment the
site can also mirror every completed run to a shared table: create a Firebase
Realtime Database (test mode is enough), paste its URL into
`website/js/core/siteConfig.js`, and a *This browser / Global* toggle appears
on the rankings page. Leave the URL empty in the copy you hand in — the brief
gives zero marks for server-side score storage, and the local table is the one
that is marked.

---

## Folder layout

```
website/                  the site itself — this is the deliverable
  index.html              home page
  how-to-play.html        the counter-strafe tutorial
  game.html               the game: canvas, HUD, menu, settings, pause, results
  register.html           account creation
  login.html              sign in
  rankings.html           leaderboard for every registered player
  profile.html            account details and personal run history
  css/
    base.css              design tokens, reset, typography, buttons, forms
    layout.css            header, navigation bar, page shell, footer
    components.css        cards, tables, badges, toasts, stat tiles
    game.css              the stage, HUD, overlays and settings form
  js/
    core/                 storage, validation, accounts — no DOM assumptions
      Storage.js          JSON wrapper around localStorage
      Validator.js        validation rules and the Validator class
      PasswordHasher.js   salted SHA-256 via Web Crypto
      UserRepository.js   the `counterbeat:users` record set
      ScoreRepository.js  the `counterbeat:scores` record set
      AuthService.js      register, login, logout, current session
      siteConfig.js       deployment settings (the optional global table URL)
      GlobalScoreboard.js the optional shared table, over Firebase's REST API
    ui/                   shared interface behaviour
      Navigation.js       active link, signed-in state, mobile menu
      FormController.js   binds a Validator to a form, inline errors
      Toast.js            non-blocking messages (the brief forbids alert())
      format.js           number, date and element helpers
    game/
      config.js           every tuning number in one place
      levels.js           the three level definitions, arena dressing included
      Settings.js         sensitivity, FOV and crosshair, persisted as JSON
      Input.js            held-key state
      CounterStrafeBody.js  the movement model — no engine dependency
      BeatMap.js          chart generation and lane geometry
      Conductor.js        the beat clock, read from the Web Audio clock
      Judge.js            grades a shot on line of sight, speed, timing and aim
      Scorer.js           score, combo, focus and the stored run record
      GameApp.js          engine boot, screen switching, controls
      audio/AudioEngine.js  Web Audio: decoding, playback, the song clock
      fps/
        FpsCamera.js      pointer lock, CS-style sensitivity, recoil, view bob
        Arena.js          the 3D room: grid floor, window wall, pads, decor
        TargetField.js    sprite-sheet bots, approach rings, hit-scan picking
        Viewmodel.js      the rifle, muzzle flash and tracer
        Hud.js            the SVG/HTML heads-up display
        Showcase.js       the drifting arena behind the menu and results
      screens/            Menu, Play, Result, SettingsPanel
    pages/                one entry point per page
  images/                 bot sprite sheet, textures, level thumbnails
  audio/                  three level tracks, a menu loop and eight effects
  vendor/                 Babylon.js 9.29

development/              not part of the site
  NOTES.md                design decisions and the numbers behind them
  REQUIREMENTS.md         functional and non-functional requirements
  asset-tools/            the scripts that generated the art and sound
  tests/simulate.mjs      headless check that the charts are playable
  tests/capture-levels.mjs  regenerates the level thumbnails from the game
```

---

## Everything here is original

No art or audio was downloaded. `development/asset-tools/gen_art.py` draws the
bot sprite sheet, the spark particle, the emblem and the tiling floor and wall
textures with Pillow; `gen_audio.py` synthesises the three level tracks, the
menu loop and all eight sound effects from oscillators and filtered noise with
numpy. The arenas themselves are built from boxes in code. Re-running the
scripts reproduces the assets exactly.

Babylon.js in `vendor/` is the one third-party library, used for the 3D
rendering, the sprite-sheet animation and ray picking. The rules of the game —
movement, charting, timing, judging and scoring — are in `js/game/` and depend
on nothing but each other; the engine only appears in `fps/`, `screens/` and
`GameApp.js`.

---

## Checking the game is fair

```bash
cd development/tests
node simulate.mjs
```

This runs the real `BeatMap`, `CounterStrafeBody`, `Judge` and `Scorer` classes
with two scripted players: one that counter-strafes, and one that only releases
the movement key. The first should clear every level at 100%, which proves the
generated charts are physically playable; the second falls apart from level 2
onwards, which is the evidence that counter-strafing is the skill the game
actually tests.

| | Counter-strafe | Release only |
| --- | --- | --- |
| Level 1 The Range | 100.0% · S | 100.0% · S |
| Level 2 Neon Alley | 100.0% · S | 71.1% · C |
| Level 3 Server Vault | 100.0% · S | 64.5% · C |

Level 1 is deliberately beatable without the technique — it is the tutorial.
The simulator grades a shot as if it were aimed perfectly; in the real game the
spread cone makes a moving shot worse still.

---

## Controls

| Action | Keys |
| --- | --- |
| Strafe left | <kbd>A</kbd> or <kbd>←</kbd> |
| Strafe right | <kbd>D</kbd> or <kbd>→</kbd> |
| Aim | Mouse (pointer locked) |
| Fire | Left click or <kbd>Space</kbd> |
| Pause (releases the mouse) | <kbd>Esc</kbd> or <kbd>P</kbd> |
| Restart level | <kbd>R</kbd> |
| Quit to menu (while paused) | <kbd>Q</kbd> |
| Fullscreen | <kbd>F</kbd> |
| Level select | <kbd>T</kbd> tutorial, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> |
