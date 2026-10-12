/**
 * PlayScreen.js
 *
 * The level itself.  It owns the arena, the bots and the rifle for one run,
 * and delegates the rules to the plain classes it is given - Conductor for
 * time, BeatMap for the chart, CounterStrafeBody for movement, Judge for
 * grading and Scorer for the running totals.
 *
 * Shooting is a hit-scan: a ray from the eye, pushed off the crosshair by a
 * random angle that grows with the player's speed.  Standing still the ray
 * is a laser; at a sprint it can land seven degrees wide.  That spread is
 * what the velocity grade in Judge is modelling, made physical.
 *
 * Everything that decides the score happens on the simulation tick clock, in
 * the same order validateRun replays it:
 *   inputs -> movement -> spawn notes -> expire missed notes -> shots
 * so the server lands on the same score to the point.
 */
import { Ray } from '../engine.js';
import { APPROACH_BEATS, GRADE, SPEED_GRADE, SPREAD } from '../rules/config.js';
import { resolveChart, musicUrls } from '../rules/charts.js';
import { BeatMap } from '../rules/BeatMap.js';
import { Conductor } from '../rules/Conductor.js';
import { CounterStrafeBody } from '../rules/CounterStrafeBody.js';
import { Judge } from '../rules/Judge.js';
import { Scorer } from '../rules/Scorer.js';
import { RunRecorder, LOG_VERSION } from '../RunRecorder.js';
import { Arena } from '../fps/Arena.js';
import { TargetField } from '../fps/TargetField.js';
import { Viewmodel } from '../fps/Viewmodel.js';

const RECOIL_DEGREES = 0.55;
/** Simulation tick bounds, inside the replay validator's limits. */
const MIN_STEP = 0.0005;
/** No longer than CounterStrafeBody integrates in one go, so a stall is split into ticks, never clamped. */
const MAX_STEP = 0.05;
const MAX_STEPS_PER_FRAME = 50;
/** A replay's ticks are cheap to apply, so after a stall (a hidden tab) it catches up at once. */
const MAX_REPLAY_STEPS_PER_FRAME = 5000;
/** An input event older than this is not trusted to back-date a shot. */
const MAX_INPUT_LAG = 0.1;
/** Longest the run waits for shaders to compile before starting anyway. */
const PREPARE_TIMEOUT_MS = 1500;
/** Pause between the last bot and the results screen. */
const RESULTS_DELAY_MS = 900;

export class PlayScreen {
    /**
     * @param {import('../GameApp.js').GameApp} app
     * @param {string} chartId
     * @param {{replay?: object}} [options] a RunRecorder log to play back
     *   instead of taking input - the ghost of a saved run.
     */
    constructor(app, chartId, options = {}) {
        this.app = app;
        this.level = resolveChart(chartId);
        this.chartId = chartId;
        this.replay = options.replay ?? null;
        /** Logs from before LOG_VERSION 4 replay with the rules they were recorded under. */
        this.legacyReplay = Boolean(this.replay && this.replay.version !== LOG_VERSION);
        this.replayCursor = 0;
        this.replayInput = 0;
        this.replayShots = 0;

        this.finished = false;
        this.paused = false;
        this.wasCounterStrafing = false;
        this.unsubscribe = [];
        this.clearedAt = undefined;
        this.tutorialStage = 0;
        this.resultsTimer = 0;
        /** Promise of the server's token for this run (ranked runs only). */
        this.runToken = null;
        /** The simulation clock, in ms, advanced tick by tick. */
        this.clockMs = 0;
    }

    /** @returns {boolean} whether this screen is still the one on show. */
    get current() {
        return this.app.current === this;
    }

    // ------------------------------------------------------------ enter ----

    async enter() {
        const { scene, camera, hud, audio, settings } = this.app;

        this.beatMap = new BeatMap(this.level);
        this.lanes = this.beatMap.lanes;
        this.lead = APPROACH_BEATS * (60 / this.level.bpm);
        this.firstNoteTime = this.beatMap.notes.length ? this.beatMap.notes[0].time : 0;
        this.judge = new Judge(this.level, this.lanes);
        this.scorer = new Scorer(this.beatMap.total);
        const scale = this.replay
            ? { speed: 1, accel: 1, ...(this.replay.movement ?? {}) }
            : { speed: settings.get('moveSpeed'), accel: settings.get('moveAccel') };
        this.movement = CounterStrafeBody.scaled(this.level.movement, scale);
        this.recorder = new RunRecorder(this.chartId, scale);
        this.body = new CounterStrafeBody(
            this.movement,
            { min: this.lanes.left + 16, max: this.lanes.right - 16 },
            this.lanes.centre(Math.floor(this.level.lanes / 2)),
        );

        this.tutorialStartX = this.body.x;
        this.arena = new Arena(scene, this.level, this.lanes);
        this.targets = new TargetField(scene, this.lanes, camera, this.level.arena.accent);
        this.viewmodel = new Viewmodel(scene, camera.camera);

        camera.resetLook();
        camera.lookEnabled = true;
        camera.update(Arena.toWorldX(this.body.x), 0, 0);

        hud.show();
        hud.setLevel(this.replay ? `REPLAY · ${this.level.name}` : this.level.name, this.level.bpm);
        hud.buildLanes(this.lanes.count);
        hud.applyCrosshair(settings);
        hud.applyVisibility(settings);
        hud.setFocus(1);
        hud.setScore(0, 0, 1);
        hud.setAccuracy(0);
        hud.setProgress(0, this.beatMap.total);
        hud.setHint('');
        hud.buildHighway(this.lanes.count);

        this.unsubscribe.push(settings.onChange(() => {
            hud.applyCrosshair(settings);
            hud.applyVisibility(settings);
        }));
        this.unsubscribe.push(camera.onLockChange((locked) => {
            if (!locked && !this.finished && !this.paused && !this.replay) {
                this.pause();
            }
        }));

        // A ranked run needs a token from the server, issued now so the
        // server can tell a run that was actually played from a copied log.
        if (!this.replay && this.app.services.startRun) {
            this.runToken = this.app.services.startRun(this.chartId);
        }
        // Compile the bot, spark and rifle shaders while the track loads,
        // so the first bot, hit and shot never stall a frame doing it.
        const prepared = Promise.race([
            Promise.all([this.targets.prepare(), this.viewmodel.prepare()]),
            new Promise((resolve) => { window.setTimeout(resolve, PREPARE_TIMEOUT_MS); }),
        ]);

        await audio.unlock();
        if (!this.current) {
            return;
        }
        if (!audio.has(this.level.musicKey)) {
            hud.setCountdown('LOADING TRACK', true);
            const ok = this.level.trackId && !this.level.custom
                ? await audio.ensure(this.level.musicKey, musicUrls(this.level.trackId))
                : false;
            if (!this.current) {
                return;
            }
            if (!ok) {
                hud.setCountdown('', false);
                this.app.failStart('The track could not be loaded. Check your connection and try again.');
                return;
            }
        }
        await prepared;
        if (!this.current) {
            return;
        }
        audio.resetMusicVolume();
        audio.playMusic(this.level.musicKey);
        this.conductor = new Conductor(() => audio.musicPosition, this.level.bpm,
            this.replay ? 0 : settings.get('audioOffset'), this.level.gridOffset);
        this.conductor.start();

        if (this.replay) {
            camera.lookEnabled = false;
            hud.setHint('Watching a replay. Press Q to leave.');
        } else {
            await camera.lock();
        }
    }

    exit() {
        const { camera, hud, audio } = this.app;
        window.clearTimeout(this.resultsTimer);
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe = [];
        camera.lookEnabled = false;
        audio.stopMusic();
        hud.hide();
        this.app.pauseOverlay.hidden = true;

        this.viewmodel.dispose();
        this.targets.dispose();
        this.arena.dispose();
    }

    // ------------------------------------------------------------- loop ----

    /** @param {number} dt seconds since the last frame */
    update(dt) {
        if (this.finished || this.paused || !this.conductor) {
            return;
        }
        const { camera, hud, audio } = this.app;
        const songTime = this.conductor.songPosition;
        this.conductor.update();

        if (this.replay) {
            this.advanceReplay(songTime);
        } else {
            this.stepSimulation(this.readDirection(), songTime, dt);
        }
        if (this.legacyReplay && !this.finished) {
            // Logs from before version 4 spawned and expired notes once per frame.
            this.advanceChart(songTime);
        }
        if (this.finished) {
            return; // the run failed inside the simulation
        }

        if (this.body.counterStrafing && !this.wasCounterStrafing) {
            audio.play('sfx-skid', { volume: 0.5 });
        }
        this.wasCounterStrafing = this.body.counterStrafing;

        this.targets.update(songTime, this.conductor.secondsPerBeat, this.level.timing.good);

        const nextNote = this.beatMap.nextNote;
        this.arena.setActiveLane(nextNote ? nextNote.lane : -1);

        const speedFraction = Math.min(1, this.body.speed / this.movement.maxSpeed);
        camera.update(Arena.toWorldX(this.body.x), dt, speedFraction);
        this.viewmodel.update(dt);

        hud.setVelocity(this.body.velocity, this.movement.maxSpeed, SPEED_GRADE.pinPoint, SPEED_GRADE.tight);
        hud.setBeat(this.conductor.beatProgress);
        hud.setLanes(nextNote ? nextNote.lane : -1,
            (this.body.x - this.lanes.left) / (this.lanes.right - this.lanes.left));
        hud.updateHighway(this.beatMap.notes, songTime, this.conductor.secondsPerBeat, this.beatMap.pendingCursor);
        this.updateCountdown(songTime);
        if (this.level.tutorial) {
            this.updateTutorial();
        }

        // The run ends shortly after the last bot is dealt with rather than
        // when the track runs out, and the tutorial cannot be failed.  A
        // replay ends when its log does (advanceReplay), wherever the music is.
        if (!nextNote && this.clearedAt === undefined) {
            this.clearedAt = songTime;
        }
        if (!this.replay && ((this.clearedAt !== undefined && songTime >= this.clearedAt + 1.2)
            || songTime >= this.beatMap.duration)) {
            this.finish(true);
        }
    }

    /** @returns {number} -1, 0 or 1 from the strafe keys currently held. */
    readDirection() {
        const { input } = this.app;
        const left = input.isDown('KeyA') || input.isDown('ArrowLeft');
        const right = input.isDown('KeyD') || input.isDown('ArrowRight');
        return (right ? 1 : 0) + (left ? -1 : 0);
    }

    /**
     * Advances the simulation up to `songTime`.
     *
     * The body is stepped on the recorder's tick clock, not the frame delta,
     * so a server replaying the same ticks reproduces it exactly.  The ticks
     * follow the audio clock rather than wall time: a stalled frame (alt-tab,
     * a garbage-collection pause) is split into several short ticks instead
     * of one clamped step, so the simulation clock never drifts away from
     * the song and the replay check never rejects an honest run for it.
     * Notes are spawned and expired at every tick, as the server does.
     *
     * @param {number} direction -1, 0 or 1
     * @param {number} songTime
     * @param {number} [dt] wall-clock seconds since the last frame (first-frame fallback)
     */
    stepSimulation(direction, songTime, dt = 0) {
        if (this.simSongTime === undefined) {
            this.simSongTime = songTime - dt;
        }
        this.body.setInput(direction);
        let remaining = songTime - this.simSongTime;
        let steps = 0;
        while (remaining >= MIN_STEP && steps < MAX_STEPS_PER_FRAME && !this.finished) {
            const step = Math.min(remaining, MAX_STEP);
            this.clockMs = this.recorder.tick(step, direction, this.simSongTime);
            // Use the rounded tick the recorder stored, so client and replay agree bit for bit.
            const stored = this.recorder.ticks[this.recorder.ticks.length - 1] / 1000;
            this.body.update(stored, this.clockMs);
            this.simSongTime = this.recorder.startSongTime + this.clockMs / 1000;
            this.advanceChart(this.simSongTime);
            remaining = songTime - this.simSongTime;
            steps += 1;
        }
        // Anything still outstanding after a very long stall is caught up on
        // the following frames, so the clock and the song always reconverge.
    }

    /**
     * Spawns the bots whose approach has begun and expires the ones whose
     * window has closed, at one instant of the simulation clock.
     * @param {number} songTime
     */
    advanceChart(songTime) {
        this.beatMap.spawnDue(songTime, this.lead, (note) => this.targets.spawn(note));
        this.beatMap.expireDue(songTime, this.level.timing.ok, (note) => {
            this.resolveNote(note, this.targets.entryFor(note), {
                grade: GRADE.MISS,
                timingError: songTime - note.time,
                speed: this.body.speed,
                inLane: this.lanes.contains(note.lane, this.body.x),
                counterStrafed: false,
                headshot: false,
                reason: 'No shot',
            }, null);
        });
        this.checkFailure();
    }

    /** Ends the run the moment focus runs out (the tutorial cannot be failed). */
    checkFailure() {
        if (this.scorer.failed && !this.level.tutorial) {
            this.finish(false);
        }
    }

    /**
     * Replay: consume the recorded ticks up to the current song time, applying
     * the recorded inputs and shots at exactly the ticks they were logged on.
     * The same order the validator uses, so the ghost does what the player
     * did, to the pixel, and lands on the stored score.
     * @param {number} songTime
     */
    advanceReplay(songTime) {
        const log = this.replay;
        const ticks = log.ticks;
        let steps = 0;
        while (this.replayCursor < ticks.length && steps < MAX_REPLAY_STEPS_PER_FRAME && !this.finished) {
            const index = this.replayCursor;
            const ms = ticks[index];
            if (log.startSongTime + (this.clockMs + ms) / 1000 > songTime) {
                break;
            }
            while (this.replayInput < log.inputs.length && log.inputs[this.replayInput][0] === index) {
                this.body.setInput(log.inputs[this.replayInput][1]);
                this.replayInput += 1;
            }
            this.clockMs += ms;
            this.body.update(ms / 1000, this.clockMs);
            const tickTime = log.startSongTime + this.clockMs / 1000;
            if (!this.legacyReplay) {
                this.advanceChart(tickTime);
            }
            while (!this.finished && this.replayShots < log.shots.length && log.shots[this.replayShots][0] === index) {
                const [, songMs, noteIndex, zoneCode, blocked] = log.shots[this.replayShots];
                this.replayShots += 1;
                const note = noteIndex >= 0 ? this.beatMap.notes[noteIndex] : null;
                const entry = note ? this.targets.entryFor(note) ?? null : null;
                const zone = ['none', 'body', 'head'][zoneCode] ?? 'none';
                this.fire({
                    songTime: this.legacyReplay ? songMs / 1000 : tickTime,
                    pick: {
                        entry: entry && zone !== 'none' ? entry : null,
                        zone: entry ? zone : 'none',
                        blocked: blocked === 1,
                        point: entry ? entry.sprite.position.clone() : null,
                    },
                });
            }
            this.replayCursor += 1;
            steps += 1;
        }
        this.aimReplayCamera();
        if (this.replayCursor >= ticks.length && !this.finished) {
            // The log ran out: the recorded run ended here.
            this.finish(this.beatMap.notes.every((note) => note.resolved));
        }
    }

    /** Points the ghost's camera at the bot it is about to deal with. */
    aimReplayCamera() {
        const camera = this.app.camera;
        let next = null;
        for (const entry of this.targets.entries) {
            if (!entry.resolved && (!next || entry.note.time < next.note.time)) {
                next = entry;
            }
        }
        let targetYaw = 0;
        let targetPitch = 0;
        if (next) {
            const eye = camera.position;
            const position = next.sprite.position;
            const dx = position.x - eye.x;
            const dy = position.y - eye.y;
            const dz = position.z - eye.z;
            targetYaw = Math.atan2(dx, dz);
            targetPitch = -Math.atan2(dy - next.sprite.height * 0.3, Math.hypot(dx, dz));
        }
        const ease = 0.18;
        camera.yaw += (targetYaw - camera.yaw) * ease;
        camera.pitch += (targetPitch - camera.pitch) * ease;
    }

    /**
     * Coaching for the tutorial level: one instruction at a time, each one
     * cleared by the player actually doing it.
     */
    updateTutorial() {
        const hud = this.app.hud;
        const stage = this.tutorialStage ?? 0;
        if (stage === 0) {
            hud.setHint('Hold  A  or  D  to strafe along the track');
            if (Math.abs(this.body.x - this.tutorialStartX) > 30) {
                this.tutorialStage = 1;
            }
        } else if (stage === 1) {
            hud.setHint('While moving, TAP the opposite key and let go. That is a counter-strafe');
            if (Number.isFinite(this.body.lastPlantedAt)) {
                this.tutorialStage = 2;
                this.app.audio.play('sfx-perfect', { volume: 0.5 });
            }
        } else if (stage === 2) {
            hud.setHint('Dead stop. Bots will step out behind a lit window: stand in front of it, stop, and click when the ring closes');
            if (this.scorer.judged > 0) {
                this.tutorialStage = 3;
            }
        } else if (stage === 3) {
            hud.setHint('The strip at the bottom shows which window is next and when. Shots spray while you move, so stop first');
            if (this.scorer.judged >= 4) {
                this.tutorialStage = 4;
            }
        } else {
            hud.setHint('');
        }
    }

    /** @param {number} songTime */
    updateCountdown(songTime) {
        const first = this.firstNoteTime;
        const until = first - songTime;
        const spb = this.conductor.secondsPerBeat;
        if (until > 0 && until < spb * 4) {
            this.app.hud.setCountdown(String(Math.ceil(until / spb)), true);
        } else if (songTime < first && !this.level.tutorial) {
            this.app.hud.setCountdown('GET READY', true);
        } else {
            this.app.hud.setCountdown('', false);
        }
    }

    // ----------------------------------------------------------- firing ----

    /**
     * @param {{songTime:number, pick:object}} [replayed] during a replay, the
     *   recorded shot time and what the recorded shot found.
     * @param {number} [inputTimeStamp] the click or key event's timeStamp, so
     *   a shot handled late (after a frame was drawn) is timed when it happened.
     */
    fire(replayed, inputTimeStamp) {
        if (this.finished || this.paused || !this.conductor) {
            return;
        }
        if (this.replay && !replayed) {
            return; // the player is only watching
        }
        const { camera, audio, hud } = this.app;
        let songTime;
        let pick;
        let ray;
        if (replayed) {
            songTime = replayed.songTime;
            pick = replayed.pick;
            ray = this.buildShotRay();
        } else {
            let target = this.conductor.songPosition;
            if (target < 0 || this.recorder.tickIndex === 0) {
                return; // the music has not started: nothing to shoot at yet
            }
            if (inputTimeStamp !== undefined) {
                const lag = (performance.now() - inputTimeStamp) / 1000;
                if (lag > 0 && lag < MAX_INPUT_LAG) {
                    target -= lag;
                }
            }
            // Bring the simulation (and the chart) up to the instant of the
            // shot, and judge it on the tick clock - exactly the time the
            // server will replay it at.
            this.stepSimulation(this.readDirection(), target);
            if (this.finished) {
                return;
            }
            songTime = this.simSongTime;
            ray = this.buildShotRay();
            pick = this.targets.pick(ray);
            this.recorder.shot(songTime, pick.entry ? pick.entry.note.index : -1, pick.zone, pick.blocked);
        }
        const hitPoint = pick.point ?? ray.origin.add(ray.direction.scale(60));

        camera.kick(RECOIL_DEGREES);
        audio.play('sfx-shot', { volume: 0.45 });
        this.viewmodel.fire(this.viewmodel.muzzlePosition, hitPoint, pick.entry !== null);

        let note = pick.entry ? pick.entry.note : null;
        let entry = pick.entry;

        // Shooting a bot long before its beat does not count as taking the
        // note: the bot flinches, the combo breaks, and the beat is still
        // there to be hit properly.
        if (note && songTime < note.time - this.level.timing.ok) {
            this.scorer.registerWildShot();
            hud.flashJudgement('TOO EARLY', 'Wait for the ring to close', 'wild');
            hud.setFocus(this.scorer.focus / 100);
            this.targets.flinch(entry);
            this.app.services.onJudgement({
                grade: GRADE.MISS, reason: 'Too early', timingError: songTime - note.time,
                speed: this.body.speed, counterStrafed: false, headshot: false, points: 0,
            });
            this.checkFailure();
            return;
        }

        if (!note) {
            note = this.beatMap.findNoteNear(songTime, this.level.timing.ok);
            entry = note ? this.targets.entryFor(note) : null;
        }

        if (!note) {
            // A shot with no bot on screen - before the first one, or after
            // the last - is free.  Only spraying between live bots costs.
            if (!this.beatMap.hasLiveNote) {
                return;
            }
            this.scorer.registerWildShot();
            hud.flashJudgement('WILD SHOT', 'No bot on that beat', 'wild');
            hud.setFocus(this.scorer.focus / 100);
            this.app.services.onJudgement({
                grade: GRADE.MISS, reason: 'Wild shot', timingError: 0,
                speed: this.body.speed, counterStrafed: false, headshot: false, points: 0,
            });
            this.checkFailure();
            return;
        }

        const judgement = this.judge.judge(
            note, songTime, this.body.x, this.body.speed, this.body.isPlanted(this.clockMs),
            { hit: pick.entry !== null, zone: pick.zone, blocked: pick.blocked },
        );
        this.resolveNote(note, entry, judgement, pick.point);
        this.checkFailure();
    }

    /**
     * The shot ray, pushed off the crosshair by the running inaccuracy.
     * @returns {Ray}
     */
    buildShotRay() {
        const { camera } = this.app;
        const fraction = Math.min(1, this.body.speed / this.movement.maxSpeed);
        const coneDegrees = SPREAD.baseDegrees + SPREAD.movingDegrees * Math.pow(fraction, SPREAD.exponent);
        const cone = (coneDegrees * Math.PI) / 180;

        // Uniform over the disc, so the shot is as likely to land at any
        // radius inside the cone as at the centre.
        const radius = cone * Math.sqrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const spreadRight = Math.tan(radius) * Math.cos(theta);
        const spreadUp = Math.tan(radius) * Math.sin(theta);

        const direction = camera.forward
            .add(camera.right.scale(spreadRight))
            .add(camera.up.scale(spreadUp))
            .normalize();
        return new Ray(camera.position.clone(), direction, 120);
    }

    /**
     * @param {object} note
     * @param {object|null} entry
     * @param {import('../Judge.js').Judgement} judgement
     * @param {Vector3|null} point
     */
    resolveNote(note, entry, judgement, point) {
        note.resolved = true;
        note.grade = judgement.grade;

        const { hud, audio } = this.app;
        const result = this.scorer.apply(judgement);
        const hit = judgement.grade !== GRADE.MISS;

        hud.showJudgement(judgement.grade, judgement.reason, result.points, result.bonus);
        hud.setScore(this.scorer.score, this.scorer.combo, this.scorer.multiplier);
        hud.setAccuracy(this.scorer.accuracy);
        hud.setFocus(this.scorer.focus / 100);
        hud.setProgress(this.scorer.judged, this.beatMap.total);

        if (hit) {
            hud.showHitmarker(judgement.headshot);
            audio.play(judgement.grade === GRADE.PERFECT ? 'sfx-perfect' : 'sfx-good', {
                volume: judgement.grade === GRADE.PERFECT ? 0.6 : 0.45,
                rate: judgement.headshot ? 1.25 : 1,
            });
        } else {
            audio.play('sfx-miss', { volume: 0.5 });
        }

        if (entry) {
            this.targets.resolve(entry, hit, point, judgement.headshot);
        }

        this.app.services.onJudgement({
            grade: judgement.grade,
            reason: judgement.reason,
            timingError: judgement.timingError,
            speed: judgement.speed,
            counterStrafed: judgement.counterStrafed,
            headshot: judgement.headshot,
            points: result.points,
        });
    }

    // -------------------------------------------------------- lifecycle ----

    pause() {
        if (this.paused || this.finished) {
            return;
        }
        this.paused = true;
        this.app.camera.lookEnabled = false;
        this.app.audio.pause();
        this.app.pauseOverlay.hidden = false;
    }

    async resume() {
        if (!this.paused || this.finished) {
            return;
        }
        this.app.pauseOverlay.hidden = true;
        // A replay is watched, not played: no pointer lock and no mouse look.
        if (!this.replay) {
            await this.app.camera.lock();
        }
        await this.app.audio.resume();
        this.app.camera.lookEnabled = !this.replay;
        this.paused = false;
    }

    restart() {
        if (this.finished) {
            return; // the run is over and on its way to the results (and to being saved)
        }
        if (this.replay) {
            this.app.showReplay(this.chartId, this.replay);
            return;
        }
        this.app.showPlay(this.chartId);
    }

    quit() {
        this.app.showMenu();
    }

    /** @param {boolean} completed */
    finish(completed) {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.conductor.stop();
        this.app.camera.lookEnabled = false;
        this.app.audio.fadeMusic(0, 0.7);
        this.app.audio.play(completed ? 'sfx-levelup' : 'sfx-gameover', { volume: 0.6 });

        const record = this.scorer.toRecord(this.level, completed);
        record.rank = this.scorer.rank;
        record.passed = completed && this.scorer.accuracy >= this.level.passAccuracy;

        // A replay hands back the log it was playing, so "Watch again" has the shots too.
        const log = this.replay ?? this.recorder.toJSON();
        const runToken = this.runToken;
        this.resultsTimer = window.setTimeout(() => {
            if (!this.current) {
                return; // the player already left this screen
            }
            this.app.camera.unlock();
            this.app.showResults(record, this.chartId, log, { replay: Boolean(this.replay), runToken });
        }, RESULTS_DELAY_MS);
    }
}
