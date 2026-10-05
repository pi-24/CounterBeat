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
 */
import { GRADE, SPEED_GRADE, SPREAD, WORLD } from '../config.js';
import { getLevel } from '../levels.js';
import { BeatMap } from '../BeatMap.js';
import { Conductor } from '../Conductor.js';
import { CounterStrafeBody } from '../CounterStrafeBody.js';
import { Judge } from '../Judge.js';
import { Scorer } from '../Scorer.js';
import { Arena } from '../fps/Arena.js';
import { TargetField } from '../fps/TargetField.js';
import { Viewmodel } from '../fps/Viewmodel.js';

const RECOIL_DEGREES = 0.55;

export class PlayScreen {
    /**
     * @param {import('../GameApp.js').GameApp} app
     * @param {number} levelId
     */
    constructor(app, levelId) {
        this.app = app;
        this.level = getLevel(levelId);
        this.levelId = levelId;

        this.finished = false;
        this.paused = false;
        this.wasCounterStrafing = false;
        this.unsubscribe = [];
        this.clearedAt = undefined;
        this.tutorialStage = 0;
    }

    // ------------------------------------------------------------ enter ----

    async enter() {
        const { scene, camera, hud, audio, settings } = this.app;

        this.beatMap = new BeatMap(this.level);
        this.lanes = this.beatMap.lanes;
        this.judge = new Judge(this.level, this.lanes);
        this.scorer = new Scorer(this.beatMap.total);
        this.body = new CounterStrafeBody(
            this.level.movement,
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
        hud.setLevel(this.level.tutorial ? this.level.name : `${this.level.id}. ${this.level.name}`, this.level.bpm);
        hud.buildLanes(this.lanes.count);
        hud.applyCrosshair(settings);
        hud.setFocus(1);
        hud.setScore(0, 0, 1);
        hud.setAccuracy(0);
        hud.setProgress(0, this.beatMap.total);
        hud.setHint('');
        hud.buildHighway(this.lanes.count);

        this.unsubscribe.push(settings.onChange(() => hud.applyCrosshair(settings)));
        this.unsubscribe.push(camera.onLockChange((locked) => {
            if (!locked && !this.finished && !this.paused) {
                this.pause();
            }
        }));

        await audio.unlock();
        audio.resetMusicVolume();
        audio.playMusic(this.level.musicKey);
        this.conductor = new Conductor(() => audio.musicPosition, this.level.bpm);
        this.conductor.start();

        await camera.lock();
    }

    exit() {
        const { camera, hud, audio } = this.app;
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
        if (this.finished || this.paused) {
            return;
        }
        const { camera, hud, input, audio } = this.app;
        const songTime = this.conductor.songPosition;
        this.conductor.update();
        const now = performance.now();

        const left = input.isDown('KeyA') || input.isDown('ArrowLeft');
        const right = input.isDown('KeyD') || input.isDown('ArrowRight');
        this.body.setInput((right ? 1 : 0) + (left ? -1 : 0));
        this.body.update(dt, now);

        if (this.body.counterStrafing && !this.wasCounterStrafing) {
            audio.play('sfx-skid', { volume: 0.5 });
        }
        this.wasCounterStrafing = this.body.counterStrafing;

        this.spawnUpcomingNotes(songTime);
        this.targets.update(songTime, this.conductor.secondsPerBeat, this.level.timing.good);
        this.expireMissedNotes(songTime);

        const nextNote = this.beatMap.notes.find((note) => !note.resolved);
        this.arena.setActiveLane(nextNote ? nextNote.lane : -1);

        const speedFraction = Math.min(1, this.body.speed / this.level.movement.maxSpeed);
        camera.update(Arena.toWorldX(this.body.x), dt, speedFraction);
        this.viewmodel.update(dt);

        hud.setVelocity(this.body.velocity, this.level.movement.maxSpeed, SPEED_GRADE.pinPoint, SPEED_GRADE.tight);
        hud.setBeat(this.conductor.beatProgress);
        hud.setLanes(nextNote ? nextNote.lane : -1,
            (this.body.x - this.lanes.left) / (this.lanes.right - this.lanes.left));
        hud.updateHighway(this.beatMap.notes, songTime, this.conductor.secondsPerBeat, this.lanes.count);
        this.updateCountdown(songTime);
        if (this.level.tutorial) {
            this.updateTutorial(songTime);
        }

        // The run ends shortly after the last bot is dealt with rather than
        // when the track runs out, and the tutorial cannot be failed.
        if (!nextNote && this.clearedAt === undefined) {
            this.clearedAt = songTime;
        }
        if (this.scorer.failed && !this.level.tutorial) {
            this.finish(false);
        } else if ((this.clearedAt !== undefined && songTime >= this.clearedAt + 1.2)
            || songTime >= this.beatMap.duration) {
            this.finish(true);
        }
    }

    /**
     * Coaching for the tutorial level: one instruction at a time, each one
     * cleared by the player actually doing it.
     * @param {number} songTime
     */
    updateTutorial(songTime) {
        const hud = this.app.hud;
        const stage = this.tutorialStage ?? 0;
        if (stage === 0) {
            hud.setHint('Hold  A  or  D  to strafe along the track');
            if (Math.abs(this.body.x - this.tutorialStartX) > 30) {
                this.tutorialStage = 1;
            }
        } else if (stage === 1) {
            hud.setHint('While moving, TAP the opposite key and let go \u2014 that is a counter-strafe');
            if (Number.isFinite(this.body.lastPlantedAt)) {
                this.tutorialStage = 2;
                this.app.audio.play('sfx-perfect', { volume: 0.5 });
            }
        } else if (stage === 2) {
            hud.setHint('Dead stop. Bots will step out behind a lit window \u2014 stand in front of it, stop, and click when the ring closes');
            if (this.scorer.judged > 0) {
                this.tutorialStage = 3;
            }
        } else if (stage === 3) {
            hud.setHint('The strip at the bottom shows which window is next and when. Shots spray while you move \u2014 stop first');
            if (this.scorer.judged >= 4) {
                this.tutorialStage = 4;
            }
        } else {
            hud.setHint('');
        }
    }

    /** @param {number} songTime */
    spawnUpcomingNotes(songTime) {
        const lead = 2 * this.conductor.secondsPerBeat;
        for (const note of this.beatMap.notes) {
            if (note.resolved || note.spawned || note.time - songTime > lead) {
                continue;
            }
            note.spawned = true;
            this.targets.spawn(note);
        }
    }

    /** @param {number} songTime */
    expireMissedNotes(songTime) {
        for (const note of this.beatMap.notes) {
            if (note.resolved || !note.spawned || songTime <= note.time + this.level.timing.ok) {
                continue;
            }
            const entry = this.targets.entryFor(note);
            this.resolveNote(note, entry, {
                grade: GRADE.MISS,
                timingError: songTime - note.time,
                speed: this.body.speed,
                inLane: this.lanes.contains(note.lane, this.body.x),
                counterStrafed: false,
                headshot: false,
                reason: 'No shot',
            }, null);
        }
    }

    /** @param {number} songTime */
    updateCountdown(songTime) {
        const first = this.beatMap.notes.length ? this.beatMap.notes[0].time : 0;
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

    fire() {
        if (this.finished || this.paused || !this.conductor) {
            return;
        }
        const songTime = this.conductor.songPosition;
        if (songTime < 0) {
            return;
        }
        const { camera, audio, hud } = this.app;
        const now = performance.now();

        const ray = this.buildShotRay();
        const pick = this.targets.pick(ray);
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
            return;
        }

        if (!note) {
            note = this.beatMap.findNoteNear(songTime, this.level.timing.ok);
            entry = note ? this.targets.entryFor(note) : null;
        }

        if (!note) {
            // A shot with no bot on screen - before the first one, or after
            // the last - is free.  Only spraying between live bots costs.
            const live = this.beatMap.notes.some((candidate) => candidate.spawned && !candidate.resolved);
            if (!live) {
                return;
            }
            this.scorer.registerWildShot();
            hud.flashJudgement('WILD SHOT', 'No bot on that beat', 'wild');
            hud.setFocus(this.scorer.focus / 100);
            this.app.services.onJudgement({
                grade: GRADE.MISS, reason: 'Wild shot', timingError: 0,
                speed: this.body.speed, counterStrafed: false, headshot: false, points: 0,
            });
            return;
        }

        const judgement = this.judge.judge(
            note, songTime, this.body.x, this.body.speed, this.body.isPlanted(now),
            { hit: pick.entry !== null, zone: pick.zone, blocked: pick.blocked },
        );
        this.resolveNote(note, entry, judgement, pick.point);
    }

    /**
     * The shot ray, pushed off the crosshair by the running inaccuracy.
     * @returns {BABYLON.Ray}
     */
    buildShotRay() {
        const { camera } = this.app;
        const fraction = Math.min(1, this.body.speed / this.level.movement.maxSpeed);
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
        return new BABYLON.Ray(camera.position.clone(), direction, 120);
    }

    /**
     * @param {object} note
     * @param {object|null} entry
     * @param {import('../Judge.js').Judgement} judgement
     * @param {BABYLON.Vector3|null} point
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
        await this.app.camera.lock();
        await this.app.audio.resume();
        this.app.camera.lookEnabled = true;
        this.paused = false;
    }

    restart() {
        this.app.showPlay(this.levelId);
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

        window.setTimeout(() => {
            this.app.camera.unlock();
            this.app.showResults(record, this.levelId);
        }, 900);
    }
}
