# CounterBeat — Requirements Specification

CST2120 Web Applications and Databases, Coursework 1 (Game Website).

Every requirement carries a **source** — either a clause of the coursework
brief, a line of the assessment criteria table, or a design decision of my own
— and a **verification** method, so each one can be demonstrated in the video.

Priorities use MoSCoW. Anything the brief awards marks for is a **Must**;
anything it forbids appears as a constraint in section 3 rather than as a
feature.

---

## 1. Scope and actors

**Product.** A browser-based rhythm game in which the player strafes into a
target lane, cancels their momentum with a counter-strafe, and fires on the
beat. Around it sits a website with registration, login, a rankings table and a
personal profile.

**Why counter-strafing.** In tactical shooters, bullets only land where you are
aiming while you are standing still, and releasing the movement key leaves you
sliding for roughly four tenths of a second. Tapping the *opposite* key cancels
the momentum almost instantly. The game takes that single technique and makes
it the thing being scored.

| Actor | Description |
| --- | --- |
| **Guest** | An unauthenticated visitor. Can browse every page and play, but runs are not saved. |
| **Registered player** | Has an account in this browser. Runs are stored, ranked and shown on their profile. |
| **Marker / assessor** | Needs to see every feature demonstrated and every stored record inspected. |

There is no server and no administrator role: the brief requires all storage to
be client-side JSON in local storage.

---

## 2. Functional requirements

### 2.1 Site and navigation

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-01 | The home page shall be named `index.html` and be the entry point to the site. | Must | Brief §3; criteria "2.5 marks — home page called index.html" | Open `index.html`; confirm file name |
| FR-02 | A navigation bar shall appear on every page with working links to the home, how-to-play, game, registration, login, rankings and profile pages. | Must | Criteria "2.5 marks — working navigation bar" | Click every link from every page |
| FR-03 | The navigation bar shall indicate the current page. | Should | Usability (5 marks) | Visual check of the highlighted item |
| FR-04 | The navigation bar shall show *Log in* and *Register* to a guest, and the player's name plus *Log out* to a signed-in user. | Must | Brief §2 (register and login) | Compare the bar before and after login |
| FR-05 | Every page shall be reachable without using the browser's back button. | Should | Criteria "usability — can they navigate without the back button?" | Navigate a full loop using links only |
| FR-06 | The site shall provide a page explaining the counter-strafe technique, the scoring and the controls. | Should | Usability; game sophistication | Open `how-to-play.html` |
| FR-07 | The home page shall show the current top five scores. | Could | Usability; engagement | Compare against the rankings page |

### 2.2 Registration

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-10 | A visitor shall be able to create an account with a display name, email address and password. | Must | Brief §2; criteria "5 marks — storage of basic data in JSON" | Register, then inspect `counterbeat:users` in DevTools |
| FR-11 | Registration shall additionally capture country, phone number, address, postcode and preferred difficulty. | Must | Criteria "5 marks — storage of additional data … for example address and phone number" | Inspect the stored record |
| FR-12 | All fields shall be validated in JavaScript, with no reliance on HTML form validation. | Must | Brief §3 ("no marks are available for HTML validation"); criteria "5 marks — validation of user data" | Submit an empty form; forms carry `novalidate` |
| FR-13 | Validation feedback shall be given inline, next to the field it concerns, and shall never use `alert()`. | Must | Brief §3 ("zero marks … implemented with alerts"); criteria | Submit invalid data; observe inline messages |
| FR-14 | A field shall be re-validated when it loses focus and again as the user corrects it. | Should | Usability | Type an invalid email, tab away, correct it |
| FR-15 | Registration shall reject a duplicate email address or display name with a message on the offending field. | Must | Login and account integrity | Register the same email twice |
| FR-16 | A successful registration shall sign the user in and take them to the game. | Should | Usability | Register and observe the redirect |
| FR-17 | Passwords shall never be written to storage in plain text. | Should | Own decision (see NFR-32) | Inspect `counterbeat:users`; only a salt and hash appear |

Validation rules applied: display name 3–20 characters from a restricted
character set and unique; a syntactically valid email address, unique; password
at least 8 characters containing a letter and a digit; a confirmation field
that must match; country and difficulty chosen from a list; phone 7–15 digits
with an optional leading `+`; address 5–120 characters; a postcode matching a
general alphanumeric pattern.

### 2.3 Login and session

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-20 | A registered user shall be able to log in with their email address and password. | Must | Brief §2; criteria "5 marks — login with appropriate error messages" | Log in with valid credentials |
| FR-21 | Login shall report an unknown email address and an incorrect password as separate, field-level errors. | Must | Criteria "…when details are missing, password incorrect, etc." | Attempt both failure cases |
| FR-22 | A missing email or password shall be caught before any credential check runs. | Must | Criteria (details missing) | Submit the empty form |
| FR-23 | The session shall persist across pages and browser restarts until the user logs out. | Must | Usability | Log in, close the tab, reopen the site |
| FR-24 | Logging out shall clear the session without deleting the account or its scores. | Must | Data integrity | Log out, log back in, confirm scores survive |
| FR-25 | A session whose account no longer exists shall be discarded silently. | Could | Robustness | Delete the user record, then reload |

### 2.4 Core gameplay

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-30 | The player shall move along a horizontal track using <kbd>A</kbd>/<kbd>D</kbd> or the arrow keys. | Must | Criteria "5 marks — basic game" | Play |
| FR-31 | Movement shall model acceleration, weak friction on release, and a strong counter-deceleration when the opposing key is pressed while still moving. | Must | Own design — the core mechanic | Watch the velocity meter under each input |
| FR-32 | A counter-strafe shall bring velocity to exactly zero on the frame it would cross zero; continuing to hold the key shall then accelerate the player in the new direction. | Must | Own design | Hold the opposing key too long and observe the overshoot |
| FR-33 | The player shall fire with a left mouse click or <kbd>Space</kbd>. | Must | User request (left click on the beat) | Play |
| FR-33a | The game shall be played in first person: the mouse is pointer-locked and turns the view through a sensitivity setting, and the arena, wall, bots and rifle are rendered in 3D. | Must | User request (FPS feel for CS/Valorant players) | Play; click the arena and look around |
| FR-33b | A shot shall be a hit-scan ray whose spread cone grows with the player's speed, from 0.12° at rest to 7.5° at top speed. | Must | Own design — running inaccuracy made physical | Fire while sprinting and watch the tracer |
| FR-33c | Each lane shall be a physical window in a wall; a shot taken from outside the lane shall hit the wall and be reported as blocked. | Must | Own design — the lane rule as geometry | Fire from the wrong lane |
| FR-33d | A shot landing on the bot's head shall be reported as a headshot and pay a 1.25× bonus. | Should | Game sophistication | Aim at the head |
| FR-33e | The player shall be able to set mouse sensitivity (with the Valorant equivalent and cm/360 shown), DPI, field of view, view bob and the crosshair's colour, length, gap, thickness and centre dot; settings shall persist as JSON in local storage. | Should | Audience expectation; criteria (additional stored data) | Change a setting, reload, confirm it held |
| FR-33f | Losing pointer lock (for example <kbd>Esc</kbd>) shall pause the run; clicking the arena shall resume it. | Must | Usability | Press Esc mid-run |
| FR-33g | The game shall offer a fullscreen mode. | Could | FPS feel | Press F |
| FR-34 | A shot shall be graded on three independent conditions — standing inside the lit lane, current speed, and timing relative to the beat — and awarded the *worst* of the three grades. | Must | Own design | Fire while moving; fire from the wrong lane; fire off-beat |
| FR-35 | A shot fired above the maximum accurate speed shall miss regardless of its timing. | Must | Own design (models first-shot accuracy) | Fire at a sprint on a perfectly timed beat |
| FR-36 | A shot whose stop was produced by a counter-strafe within the last 320 ms shall receive a 1.5× score bonus. | Must | User request — counter-strafing as the primary skill | Compare a released stop with a counter-strafed stop |
| FR-37 | A note that passes its window without being shot shall be recorded as a miss. | Must | Scoring integrity | Stand still and let a note pass |
| FR-38 | A shot fired with no note inside the timing window shall break the combo and cost focus. | Should | Prevents spam-clicking | Click repeatedly between notes |
| FR-39 | Score shall combine a grade base value, a combo multiplier rising to 2× at 50 consecutive hits, and the counter-strafe bonus. | Must | Criteria "obtain a score" | Build a combo and watch the multiplier |
| FR-40 | A focus bar shall fall on misses and rise on clean hits; a run shall end early when it empties. | Should | Game sophistication — a fail state | Miss repeatedly |
| FR-41 | The player shall be able to pause, resume, restart the level, and quit to the menu. | Should | Usability | Press <kbd>Esc</kbd>, <kbd>R</kbd>, <kbd>Q</kbd> |
| FR-42 | The game shall display live score, combo, weighted accuracy, note progress, current velocity and the most recent judgement. | Must | Usability; criteria (score) | Play and read the HUD |

### 2.5 Levels and progression

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-50 | The game shall provide at least three levels that differ in tempo, note density, lane count, lane width, movement speed and timing tolerance. | Must | Criteria "5 marks — multiple levels … the game gets harder" | Compare levels 1 and 3 |
| FR-51 | Each level shall use a visually distinct environment and its own music track. | Must | Criteria "…they play in a different environment" | Compare backdrops and audio |
| FR-52 | A level shall remain locked until the previous level has been completed at or above its pass accuracy. | Must | Criteria (progression) | Attempt level 2 from a fresh account |
| FR-53 | Each level's note chart shall be generated deterministically from a fixed seed, so the same level is identical on every playthrough. | Should | Fair comparison of scores | Play a level twice and compare the chart |
| FR-54 | The chart generator shall only place a lane change the player could physically reach in the time available. | Must | Playability | Run `development/tests/simulate.mjs` |
| FR-55 | The results screen shall show a rank letter, score, weighted accuracy, per-grade tallies, best combo and counter-strafe count. | Should | Usability | Finish a run |

### 2.6 Presentation and feedback

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-60 | The bots shall be animated from a sprite sheet with distinct states for idle, being hit and collapsing. | Must | Criteria "2.5 marks — character animation with a sprite sheet" | Watch a bot while playing; inspect `images/bot-sheet.png` |
| FR-60a | The rifle shall kick on every shot with a muzzle flash and a tracer to the point the shot reached, and the view shall recoil and recover. | Should | FPS feel | Fire |
| FR-60b | A hitmarker shall flash on the crosshair on every hit, distinctly for a headshot. | Should | FPS feel | Hit a bot |
| FR-61 | The game shall play sound effects for firing, a skid, each judgement grade, level completion and failure. | Must | Criteria "2.5 marks — sound effects" | Play with sound on |
| FR-62 | Each level shall play a music track whose tempo matches the chart. | Must | It is a rhythm game | Play |
| FR-63 | An approach ring shall close on each bot, and a ring around the crosshair shall pulse with the beat, so the timing is readable without sound. | Should | Usability; accessibility | Play muted |
| FR-64 | A velocity meter shall show current speed against the accuracy thresholds. | Should | Usability — it teaches the mechanic | Observe the meter while strafing |
| FR-65 | The site shall use a single consistent visual style across all pages. | Must | Criteria "10 marks — attractiveness … do all pages have the same style?" | Visual review of every page |

### 2.7 Scores and rankings

| ID | Requirement | Priority | Source | Verification |
| --- | --- | --- | --- | --- |
| FR-70 | Every completed run by a signed-in player shall be stored as a JSON record in local storage. | Must | Criteria "5 marks — storage of users' top scores in JSON format using HTML local storage" | Finish a run; inspect `counterbeat:scores` |
| FR-71 | A run record shall include the level, score, weighted accuracy, best combo, counter-strafe count, per-grade tallies, completion flag and timestamp. | Must | Rankings and profile content | Inspect a stored record |
| FR-72 | The rankings page shall list the best run of every registered player. | Must | Brief §2; criteria "5 marks — rankings page that lists the top scores of all users" | Register two accounts, play both, open rankings |
| FR-73 | The rankings table shall be filterable by level, sortable by score, accuracy, combo or counter-strafes, and searchable by player name. | Should | Usability | Exercise each control |
| FR-74 | The signed-in player's own row shall be highlighted. | Could | Usability | Open rankings while logged in |
| FR-75 | A signed-in player shall have a profile page showing their stored account details, best run per level and recent run history. | Should | Demonstrates FR-11 storage; usability | Open `profile.html` |
| FR-76 | A player shall be able to clear their own run history without deleting their account. | Could | Data control | Use the clear button, then check the account survives |
| FR-77 | Guest runs shall not be written to storage, and the player shall be told so. | Should | Rankings integrity | Play logged out; inspect storage |

---

## 3. Non-functional requirements

### 3.1 Technology constraints (imposed by the brief)

| ID | Requirement | Source | Verification |
| --- | --- | --- | --- |
| NFR-01 | The site shall be built only from HTML, CSS and JavaScript. | Brief §3 | Inspect the file listing |
| NFR-02 | JavaScript shall target ES2020 or later, and the `var` keyword shall not appear anywhere. | Brief §3 ("zero marks … implemented with the var keyword") | `grep -rn "\bvar\b" js/` returns nothing |
| NFR-03 | All JavaScript shall live in separate `.js` files; no JavaScript shall appear inside an HTML file, including inline event handlers. | Brief §3 ("zero marks for JavaScript in the HTML") | Search the HTML for `<script>` without `src`, and for `on*=` attributes |
| NFR-04 | All CSS shall live in separate `.css` files shared across pages; no `style` attributes and no `<style>` elements. | Brief §3; criteria ("do not use separate CSS files for each page") | Search the HTML for `style=` and `<style` |
| NFR-05 | JavaScript, CSS and images shall sit in their own folders, with the HTML files at the root of the code folder. | Brief §3; criteria "3 marks — file organization" | Inspect the folder tree |
| NFR-06 | No server-side code shall be used; no PHP, Python, or any database. | Brief §3 | Inspect the file listing |
| NFR-07 | All user data and scores shall be stored as JSON in HTML local storage. | Brief §3 | Inspect DevTools → Application → Local Storage |
| NFR-08 | No functionality shall depend on `alert()`, `confirm()` or `prompt()`. | Brief §3 | `grep -rn "alert(" js/` returns only comments |
| NFR-09 | Documentation (report and video) shall not be placed in the same folder as the code. | Brief §3; criteria (zero marks for file organisation otherwise) | Inspect the submitted zip |
| NFR-10 | Cross-browser compatibility is not required; the site shall be demonstrated working in one browser (Chrome). | Brief §3 | Demonstration video |
| NFR-11 | One third-party library (Babylon.js 9.29, named in the brief) shall be used, for 3D rendering, sprite-sheet animation and ray picking; the rules of the game shall not depend on it. | Brief §3 (libraries permitted, check with module leader); criteria "5 marks — game engine" | `grep -rln BABYLON js/` lists only `fps/`, `screens/`, `GameApp.js` and the page script; `BeatMap`, `CounterStrafeBody`, `Judge` and `Scorer` run in Node with no engine present |

### 3.2 Code quality and structure

| ID | Requirement | Source | Verification |
| --- | --- | --- | --- |
| NFR-20 | Game code shall be organised as ES modules with a single responsibility each. | Criteria "5 marks — modules … full marks only for a fully modular implementation" | Inspect `js/` — 38 modules across `core/`, `ui/`, `game/`, `game/audio/`, `game/fps/`, `game/screens/` and `pages/` |
| NFR-21 | Game behaviour shall be divided across several classes rather than one large class. | Criteria "5 marks — classes … a single large class that handles everything will get a maximum of 2 marks" | 31 classes; inspect the rules classes, `FpsCamera`, `Arena`, `TargetField`, `Viewmodel`, `Hud`, `AudioEngine` and the three screens |
| NFR-22 | The rules of the game (movement, charting, timing, judging, scoring) shall be expressed in classes with no dependency on the rendering library. | Own decision — testability | Run the simulator, which loads those classes in Node with no browser |
| NFR-23 | All local-storage access shall pass through one wrapper class. | Own decision — maintainability | Only `Storage.js` references `localStorage` |
| NFR-24 | The game shall communicate with the website through an injected services object, never by importing a repository directly. | Own decision — separation of concerns | No repository import in `js/game/` |
| NFR-25 | Every file and every non-obvious method shall carry a comment explaining its purpose. | Criteria "code quality … well commented, tidy and easy to read" | Read any source file |
| NFR-26 | There shall be no unused files and no commented-out code in the submitted code folder. | Criteria "marks will be deducted for unused files and commented out code" | Review the submission before zipping |
| NFR-27 | All tuning values shall be declared as named constants in one configuration module rather than scattered as literals. | Own decision — maintainability | Inspect `js/game/config.js` |

### 3.3 Performance and timing

| ID | Requirement | Source | Verification |
| --- | --- | --- | --- |
| NFR-30 | The game shall run at 60 frames per second on a mid-range laptop. | Playability | DevTools performance panel during a level-3 run |
| NFR-31 | Judgement timing shall be derived from the Web Audio clock that is playing the track, not from accumulated frame deltas, so the chart cannot drift from the music. | Own decision — the tightest window is 38 ms | Inspect `AudioEngine.js` and `Conductor.js`; play a full level and confirm the beat stays aligned |
| NFR-31a | Mouse look shall use raw, unaccelerated pointer-lock input, with yaw per count equal to Counter-Strike's 0.022° × sensitivity. | Audience expectation | Inspect `FpsCamera.js`; compare cm/360 against a known setup |
| NFR-31b | Dynamic HUD values shall be written as SVG attributes, classes or text, never as inline styles. | Brief §3 (no `style` attributes) | Inspect the DOM while playing |
| NFR-32 | Input-to-judgement latency shall be within one frame of the click. | Playability | Judgements are computed in the click handler, not deferred |
| NFR-33 | The stored score list shall be capped so a long session cannot exhaust the local-storage quota. | Robustness | Inspect the cap in `ScoreRepository.js` |

### 3.4 Usability and accessibility

| ID | Requirement | Source | Verification |
| --- | --- | --- | --- |
| NFR-40 | The interface shall be legible at a typical laptop resolution and the layout shall not break down to mobile width. | Criteria "10 marks — attractiveness", "5 marks — usability" | Resize the window |
| NFR-41 | Text shall meet WCAG AA contrast against its background. | Accessibility | Contrast check on the palette |
| NFR-42 | All interactive elements shall be reachable by keyboard and shall show a visible focus ring. | Accessibility | Tab through each page |
| NFR-43 | Every form input shall have an associated `<label>`, and validation messages shall be announced through a live region. | Accessibility | Inspect the markup |
| NFR-44 | All images shall carry descriptive alternative text. | Accessibility | Inspect the markup |
| NFR-45 | The game shall be playable with the sound muted, through the approach rings and the velocity meter. | Accessibility | Play muted |
| NFR-46 | The controls and the counter-strafe technique shall be visible beside the game, not only on a separate page. | Usability | Open `game.html` |

### 3.5 Data, security and privacy

| ID | Requirement | Source | Verification |
| --- | --- | --- | --- |
| NFR-50 | Passwords shall be stored as a SHA-256 hash of a per-account random salt concatenated with the password. | Own decision | Inspect a stored record |
| NFR-51 | The limits of client-side password storage shall be documented rather than overstated. | Academic honesty | See `development/NOTES.md` §7 |
| NFR-52 | No data shall leave the user's browser; there are no network requests after page load. | Brief §3 (no server) | DevTools network panel |
| NFR-53 | Corrupt or unreadable stored JSON shall degrade one feature rather than throwing on page load. | Robustness | Write invalid JSON into a storage key and reload |
| NFR-54 | The site shall report clearly when local storage is unavailable, for example in private browsing. | Robustness | Open the site with storage blocked |

### 3.6 Originality and maintainability

| ID | Requirement | Source | Verification |
| --- | --- | --- | --- |
| NFR-60 | The game shall not be copied from any existing game, tutorial or template. | Brief §2 ("zero marks … for a game that is copied from the Internet") | The mechanic, physics model and chart generator are original work |
| NFR-61 | All artwork and audio shall be created for this project. | Brief §2; plagiarism policy §8 | The generator scripts in `development/asset-tools/` reproduce every asset |
| NFR-62 | The playability of every generated chart shall be verifiable without playing it by hand. | Own decision | `node development/tests/simulate.mjs` |
| NFR-63 | The project shall include instructions for running it, since ES modules require a web server. | Usability for the marker | See `README.md` |

---

## 4. Assumptions and exclusions

1. **Single-player only.** The brief allows a game played "alone or against the
   computer"; CounterBeat is played alone against a fixed chart, which
   satisfies the first of those.
2. **One browser, one machine.** Because storage is local, accounts and
   rankings exist per browser profile. Two players on the same machine and
   browser will see each other on the rankings table; two players on different
   machines will not. This follows directly from the no-server constraint.
3. **A local web server is required.** ES modules are blocked over the `file://`
   protocol, so the site must be opened through `http://`. This is a
   consequence of NFR-03 and the modules mark, not a defect.
4. **Touch input is out of scope.** The pages are responsive, but the game needs
   a keyboard, a mouse and pointer lock, and a browser with WebGL.
5. **No audio-offset calibration.** The timing is taken from the audio clock and
   is accurate, but a player on Bluetooth headphones hears the beat late and
   cannot compensate for it in-game.

---

## 5. Traceability to the assessment criteria

| Criterion | Marks | Requirements |
| --- | --- | --- |
| Home page called `index.html` | 2.5 | FR-01 |
| Working navigation bar | 2.5 | FR-02, FR-04 |
| Attractiveness | 10 | FR-65, NFR-04, NFR-40, NFR-41 |
| Usability | 5 | FR-03, FR-05, FR-06, FR-42–FR-46, FR-73 |
| Basic game with a score | 5 | FR-30, FR-33, FR-39, FR-42 |
| Modules | 5 | NFR-20, NFR-22, NFR-24 |
| Classes | 5 | NFR-21, NFR-22 |
| Game engine | 5 | NFR-11 |
| Multiple levels | 5 | FR-50, FR-51, FR-52 |
| Sprite-sheet animation | 2.5 | FR-60 |
| (FPS presentation — supports attractiveness, usability, sophistication) | — | FR-33a–g, FR-60a–b |
| Sound effects | 2.5 | FR-61, FR-62 |
| Storage of basic user data in JSON | 5 | FR-10, NFR-07 |
| Storage of additional user data | 5 | FR-11, FR-75 |
| JavaScript validation with feedback | 5 | FR-12, FR-13, FR-14, NFR-08 |
| Login with error messages | 5 | FR-20, FR-21, FR-22 |
| Storage of top scores in JSON | 5 | FR-70, FR-71 |
| Rankings page for all users | 5 | FR-72, FR-73, FR-74 |
| HTML / CSS / JavaScript code quality | 7 | NFR-02–NFR-04, NFR-25, NFR-26, NFR-27 |
| File organisation | 3 | NFR-05, NFR-09 |
