# CounterBeat — Requirements

## Functional requirements

What the system does.

1. A visitor can create an account with a display name, email address and password.
2. Registration also captures country, phone number, address, postcode and preferred difficulty.
3. Every field is validated in JavaScript, with messages shown inline beside the field rather than in a pop-up.
4. Registration refuses a duplicate email address or display name.
5. A registered user can log in with their email address and password.
6. Login reports an unknown email address and an incorrect password as separate errors on the relevant field.
7. The user stays logged in across pages and browser restarts, and can log out without losing their account or scores.
8. A navigation bar appears on every page, links to all of them, marks the current page, and changes between the guest and signed-in states.
9. A how-to-play page explains the counter-strafe technique, the scoring and the controls.
10. The player moves along a horizontal track with A and D or the arrow keys.
11. Releasing the movement key leaves the player sliding; pressing the opposite key stops them dead. Holding it too long sends them back the other way.
12. The game is played in first person: the mouse is pointer-locked and aims through a sensitivity setting, and the arena, the wall, the bots and the rifle are rendered in 3D.
12a. The player fires with a left mouse click or the space bar; a shot is a hit-scan ray whose spread cone grows with speed, from a tenth of a degree at rest to seven and a half degrees at a sprint.
12b. Each lane is a physical window in a wall; a shot from outside the lane hits the wall and is reported as blocked.
12c. A shot on the bot's head is a headshot and pays 1.25×.
12d. The player can set sensitivity (shown with its Valorant equivalent and cm/360), DPI, field of view, view bob and the crosshair's colour, length, gap, thickness and dot; settings persist as JSON in local storage.
12e. Losing pointer lock pauses the run; clicking the arena resumes it. F toggles fullscreen.
13. Each shot is judged on three things at once — standing in the lit lane, current speed, and timing against the beat — and scores the worst of the three.
14. A shot fired above the maximum accurate speed misses however well it was timed.
15. A stop produced by a counter-strafe earns a 1.5× bonus on that note.
16. A note that passes without being shot counts as a miss; a shot fired with no note nearby breaks the combo.
17. Score combines the grade, a combo multiplier rising to 2× at fifty consecutive hits, and the counter-strafe bonus.
18. A focus bar falls on misses and rises on clean hits, ending the run early if it empties.
19. The player can pause, resume, restart the level and quit to the menu.
20. The screen shows live score, combo, accuracy, note progress, current velocity and the most recent judgement.
21. There are three levels, each with its own tempo, note density, lane count, lane width, movement speed and timing tolerance.
22. Each level has its own environment and music track.
23. A level stays locked until the one before it is finished at or above its pass accuracy.
24. Each level's chart is generated from a fixed seed, so it is identical every time it is played.
25. The chart generator only places a lane change the player could physically reach in the time available.
26. A results screen shows a rank letter, score, accuracy, per-grade tallies, best combo and counter-strafe count.
27. The bots are animated from a sprite sheet with states for idle, being hit and collapsing; the rifle kicks with a muzzle flash and tracer, the view recoils, and a hitmarker flashes on every hit.
28. Sound effects play for firing, skidding, each judgement, level completion and failure.
29. Every completed run by a signed-in player is stored as JSON in local storage.
30. The rankings page lists the best run of every registered player, and can be filtered by level, sorted and searched by name.
31. A profile page shows the player's stored account details, best run per level and recent history, and lets them clear that history.
32. A guest can play every unlocked level, but their runs are not saved and they are told so.

## Non-functional requirements

How the system has to behave and be built.

1. Built only from HTML, CSS and JavaScript, with no server-side code and no database.
2. JavaScript targets ES2020 or later; the `var` keyword appears nowhere.
3. All JavaScript sits in separate files — none inside an HTML file, including inline event handlers.
4. All CSS sits in separate files shared across pages — no `style` attributes and no `<style>` elements.
5. JavaScript, CSS and images each have their own folder, the HTML files sit at the root of the code folder, and the documentation sits outside it.
6. All user data and scores are stored as JSON in local storage.
7. No feature depends on `alert()`, `confirm()` or `prompt()`.
8. Demonstrated in one browser; cross-browser support is not attempted.
9. Babylon.js (named in the brief) is the only third-party library, used for 3D rendering, sprite animation and ray picking; the rules of the game do not depend on it.
10. The code is organised as ES modules with a single responsibility each — thirty-eight modules and thirty-one classes.
11. Movement, chart generation, timing, judging and scoring are plain classes that run outside a browser, which is how they are tested.
12. All local-storage access goes through one wrapper class.
13. The game reaches the website through an injected services object, never by importing storage directly.
14. Every file and non-obvious method is commented; no unused files and no commented-out code are submitted.
15. All tuning values live in one configuration module rather than scattered through the code.
16. The game runs at sixty frames per second on a mid-range laptop.
17. Timing comes from the Web Audio clock playing the track, not from frame deltas, because the tightest window is thirty-eight milliseconds.
17a. Mouse look uses raw, unaccelerated pointer-lock input at Counter-Strike's 0.022° per count × sensitivity.
17b. Every dynamic HUD value is written as an SVG attribute, a class or text — never as an inline style.
18. The stored score list is capped so a long session cannot exhaust the storage quota.
19. The layout stays readable from a laptop down to phone width.
20. Text meets WCAG AA contrast, every control is keyboard reachable with a visible focus ring, every input has a label, and every image has alternative text.
21. The game is playable with the sound off, using the approach rings and the velocity meter.
22. Passwords are stored as a SHA-256 hash of a per-account random salt, and the limits of doing this client-side are documented rather than overstated.
23. No data leaves the browser; there are no network requests after the page loads.
24. Corrupt stored JSON degrades one feature instead of breaking the page.
25. The site reports clearly when local storage is unavailable, such as in private browsing.
26. The game is not copied from anywhere, and all artwork and audio were generated for this project by scripts that reproduce them exactly.
27. The playability of every generated chart can be checked by simulation without playing it by hand.
28. Instructions for running the site are included, since ES modules require a local web server.
