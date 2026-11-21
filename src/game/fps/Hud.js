/**
 * Hud.js
 *
 * The heads-up display, drawn in HTML and SVG on top of the canvas rather
 * than inside the 3D scene, because text and gauges are far crisper that
 * way and the stylesheet keeps them consistent with the rest of the site.
 *
 * Every dynamic value is written as an SVG attribute, a class or a text node
 * - never as an inline style - so the page keeps the clean separation between
 * markup, style and behaviour that the rest of the site has.
 *
 * Most of this runs every frame, so every write goes through a cache and
 * only reaches the DOM when the value actually changed: an unchanged
 * attribute or class still costs a style recalculation if it is written.
 */
import { APPROACH_BEATS, GRADE_LABEL, SPEED_GRADE } from '../rules/config.js';
import { paletteFor } from '../feel/judgementPalette.js';
import {
    botCounter, progressSegments, multiplierLabel, headLabel, paceLabel, stopMeterLayout, meterMarkerX,
    stopReadout, judgementPlate, pushRecent,
} from './hudText.js';
import { arcColour, arcFill, arcTickSpeeds } from '../feel/speedArc.js';

const ARC_RADIUS = 40;
const ARC_START_DEG = 150;
const ARC_SPAN_DEG = 240 / 2; // 120 degrees across the bottom of the crosshair

/** Judgement grade -> the shape class that carries it (shape + brightness, never hue alone). */
const GRADE_SHAPE = Object.freeze({ perfect: 'perfect', good: 'good', ok: 'loose', miss: 'miss', wild: 'miss' });

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far ahead the note strip shows, in beats (bots appear APPROACH_BEATS ahead). */
const HIGHWAY_BEATS = 4;
/** Height of the strip in its SVG viewBox units. */
const HIGHWAY_HEIGHT = 110;

/** Last value written per element and attribute, so repeats are skipped. */
const written = new WeakMap();

/**
 * @param {Element} element
 * @param {string} name attribute name, or 'class' / 'text'
 * @param {string} value
 */
function write(element, name, value) {
    let values = written.get(element);
    if (!values) {
        values = new Map();
        written.set(element, values);
    }
    if (values.get(name) === value) {
        return;
    }
    values.set(name, value);
    if (name === 'text') {
        element.textContent = value;
    } else {
        element.setAttribute(name, value);
    }
}

/** Restarts an element's CSS animations without forcing a layout. */
function replayAnimations(element) {
    for (const animation of element.getAnimations()) {
        animation.cancel();
        animation.play();
    }
}

export class Hud {
    /** @param {HTMLElement} root the #hud element. */
    constructor(root) {
        this.root = root;
        this.find = (id) => root.querySelector(`#${id}`);

        this.levelText = this.find('hudLevel');
        this.bpmText = this.find('hudBpm');
        this.diffText = this.find('hudDiff');
        this.progressText = this.find('hudProgress');
        this.totalText = this.find('hudTotal');
        this.segsEl = this.find('botSegs');
        this.segments = [];
        this.scoreText = this.find('hudScore');
        this.comboText = this.find('hudCombo');
        this.multText = this.find('hudMult');
        this.accuracyText = this.find('hudAccuracy');
        this.headText = this.find('hudHead');
        this.paceText = this.find('hudPace');
        this.recentEl = this.find('recentLog');
        this.csNote = this.find('csNote');
        this.recent = [];
        this.focusFill = this.find('focusFill');
        this.beatRing = this.find('beatRing');
        this.beatCueEl = this.find('beatCue');
        this.beatCueOn = false;
        this.softCue = false;
        this.palette = paletteFor('default');
        this.judgeBox = this.find('judgement');
        this.judgeShape = this.find('judgeShape');
        this.judgeText = this.find('judgeText');
        this.judgeMs = this.find('judgeMs');
        this.judgeHead = this.find('judgeHead');
        this.judgeReason = this.find('judgeReason');
        this.countdown = this.find('countdown');
        this.hitmarker = this.find('hitmarker');
        this.crosshair = this.find('crosshair');
        this.laneStrip = this.find('laneStrip');
        this.velocitySvg = this.find('velocity');
        this.velocityText = this.find('velocityText');
        this.meterLegend = this.find('meterLegend');

        this.speedArc = this.find('speedArc');
        this.arcFill = this.speedArc?.querySelector('[data-part="fill"]');
        this.arcTicks = this.speedArc ? {
            perfect: this.speedArc.querySelector('[data-part="tickPerfect"]'),
            good: this.speedArc.querySelector('[data-part="tickGood"]'),
            loose: this.speedArc.querySelector('[data-part="tickLoose"]'),
        } : null;
        this.arcScale = 0;
        this.perfectFlash = this.find('perfectFlash');
        this.velocityMarker = this.velocitySvg.querySelector('[data-part="marker"]');
        this.meterZones = {
            perfect: this.velocitySvg.querySelector('[data-part="perfect"]'),
            good: this.velocitySvg.querySelector('[data-part="good"]'),
            loose: this.velocitySvg.querySelector('[data-part="loose"]'),
        };
        this.meterDrawn = false;

        this.hint = this.find('hudHint');
        this.highway = this.find('noteHighway');

        this.laneRects = [];
        this.lanePlayer = null;
        this.activeLane = undefined;
        /** @type {Map<object, SVGElement>} note -> its marker on the highway */
        this.highwayMarkers = new Map();
        this.highwayLines = [];
        this.highwayLanes = 1;
    }

    /** @param {string} text an instruction line; empty hides it. */
    setHint(text) {
        if (this.hintText === text) {
            return;
        }
        this.hintText = text;
        this.hint.textContent = text;
        this.hint.classList.toggle('is-visible', text !== '');
    }

    /**
     * Prepares the "note highway": upcoming bots slide down their lane's
     * column towards the lane strip and land on it exactly on the beat, so
     * the player can read the next window and its timing before it arrives.
     * @param {number} laneCount
     */
    buildHighway(laneCount) {
        while (this.highway.firstChild) {
            this.highway.firstChild.remove();
        }
        this.highwayMarkers.clear();
        this.highwayLines = [];
        this.highwayLanes = laneCount;

        const slot = 600 / laneCount;
        for (let i = 0; i < laneCount; i += 1) {
            const column = document.createElementNS(SVG_NS, 'rect');
            column.setAttribute('x', String(i * slot + 4));
            column.setAttribute('y', '0');
            column.setAttribute('width', String(slot - 8));
            column.setAttribute('height', '110');
            column.setAttribute('class', 'hud__highway-column');
            this.highway.append(column);
        }
        for (let i = 0; i < 5; i += 1) {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', '0');
            line.setAttribute('x2', '600');
            line.setAttribute('class', 'hud__highway-beat');
            this.highway.append(line);
            this.highwayLines.push(line);
        }

        // The strip looks further ahead than bots appear.  This line marks
        // the moment a bot steps out: a dot crossing it turns "out" at the
        // same instant its bot appears behind the window.
        const spawnY = String(HIGHWAY_HEIGHT - (APPROACH_BEATS / HIGHWAY_BEATS) * HIGHWAY_HEIGHT);
        const spawnLine = document.createElementNS(SVG_NS, 'line');
        spawnLine.setAttribute('x1', '0');
        spawnLine.setAttribute('x2', '600');
        spawnLine.setAttribute('y1', spawnY);
        spawnLine.setAttribute('y2', spawnY);
        spawnLine.setAttribute('class', 'hud__highway-spawn');
        this.highway.append(spawnLine);
    }

    /**
     * @param {object[]} notes the chart, sorted by time
     * @param {number} songTime
     * @param {number} secondsPerBeat
     * @param {number} [fromIndex] the earliest note that can still be unresolved
     */
    updateHighway(notes, songTime, secondsPerBeat, fromIndex = 0) {
        const lookahead = HIGHWAY_BEATS * secondsPerBeat;
        const height = HIGHWAY_HEIGHT;
        const slot = 600 / this.highwayLanes;

        // Beat grid lines scroll down with the music.
        const nextBeat = Math.ceil(songTime / secondsPerBeat) * secondsPerBeat;
        this.highwayLines.forEach((line, i) => {
            const remaining = nextBeat + i * secondsPerBeat - songTime;
            const y = (height - (remaining / lookahead) * height).toFixed(1);
            write(line, 'y1', y);
            write(line, 'y2', y);
            write(line, 'opacity', remaining <= lookahead ? '1' : '0');
        });

        // Drop markers for notes that were judged or have passed the strip.
        for (const [note, marker] of this.highwayMarkers) {
            if (note.resolved || note.time - songTime < -0.05) {
                marker.remove();
                this.highwayMarkers.delete(note);
            }
        }

        let first = true;
        for (let i = fromIndex; i < notes.length; i += 1) {
            const note = notes[i];
            const remaining = note.time - songTime;
            if (remaining > lookahead) {
                break; // sorted: everything after this is further away
            }
            if (note.resolved || remaining < -0.05) {
                continue;
            }
            let node = this.highwayMarkers.get(note);
            if (!node) {
                node = document.createElementNS(SVG_NS, 'circle');
                node.setAttribute('cx', String(note.lane * slot + slot / 2));
                node.setAttribute('r', '9');
                this.highway.append(node);
                this.highwayMarkers.set(note, node);
            }
            const y = height - (Math.max(0, remaining) / lookahead) * height;
            write(node, 'cy', y.toFixed(1));
            // "is-out" once the note's bot has stepped out (it crossed the spawn line).
            write(node, 'class', `hud__highway-note${note.spawned ? ' is-out' : ''}${first ? ' hud__highway-note--next' : ''}`);
            first = false;
        }
    }

    show() {
        this.root.hidden = false;
    }

    hide() {
        this.root.hidden = true;
    }

    /**
     * @param {string} name track title
     * @param {number} bpm
     * @param {string} [detail] difficulty and tags, e.g. "Hard" or "Hard · PLACEHOLDER MUSIC"
     */
    setLevel(name, bpm, detail = '') {
        this.levelText.textContent = name;
        this.bpm = bpm;
        write(this.bpmText, 'text', `${Math.round(bpm)} BPM`);
        write(this.diffText, 'text', detail);
    }

    /** @param {number} judged @param {number} total */
    setProgress(judged, total) {
        const counter = botCounter(judged, total);
        write(this.progressText, 'text', counter.current);
        write(this.totalText, 'text', counter.total);
        const { count, done } = progressSegments(judged, total);
        if (this.segments.length !== count) {
            this.segsEl.replaceChildren();
            this.segments = [];
            for (let i = 0; i < count; i += 1) {
                const seg = document.createElement('i');
                this.segsEl.append(seg);
                this.segments.push(seg);
            }
        }
        this.segments.forEach((seg, i) => write(seg, 'class', i < done ? 'is-done' : (i === done ? 'is-now' : '')));
    }

    /** @param {number} score @param {number} combo @param {number} multiplier */
    setScore(score, combo, multiplier) {
        write(this.scoreText, 'text', score.toLocaleString('en-GB'));
        write(this.comboText, 'text', String(combo));
        write(this.comboText, 'class', `hud__combo${combo >= 2 ? ' is-live' : ''}`);
        write(this.multText, 'text', multiplierLabel(multiplier));
    }

    /** @param {number} fraction 0..1 */
    setAccuracy(fraction) {
        write(this.accuracyText, 'text', `${(fraction * 100).toFixed(2)}%`);
    }

    /**
     * Headshots over bots hit, and the projected rank.
     * @param {{headshots:number, hits:number, rank:string, judged:number}} stats
     */
    setStats({ headshots, hits, rank, judged }) {
        write(this.headText, 'text', headLabel(headshots, hits));
        write(this.paceText, 'text', paceLabel(rank, judged));
    }

    /** @param {number} fraction 0..1 */
    setFocus(fraction) {
        write(this.focusFill, 'width', String(Math.max(0, Math.min(1, fraction)) * 1000));
        const state = fraction > 0.5 ? 'ok' : (fraction > 0.25 ? 'warn' : 'danger');
        write(this.focusFill, 'class', `hud__focus-fill hud__focus-fill--${state}`);
    }

    /** Clears the "last 8" log and the counter-strafe note (run start / restart). */
    resetRecent() {
        this.recent = [];
        this.renderRecent();
        this.csNote.classList.remove('is-on');
    }

    renderRecent() {
        const shapes = this.recent;
        while (this.recentEl.children.length > shapes.length) {
            this.recentEl.lastElementChild.remove();
        }
        shapes.forEach((grade, i) => {
            let node = this.recentEl.children[i];
            if (!node) {
                node = document.createElement('i');
                this.recentEl.append(node);
            }
            write(node, 'class', `shape shape--${GRADE_SHAPE[grade] ?? 'miss'}${i === shapes.length - 1 ? ' is-latest' : ''}`);
        });
    }

    /**
     * The stop meter: signed strafe speed against the Perfect / Good / Loose zones, drawn to scale
     * from the locked thresholds (SPEED_GRADE).
     * @param {number} velocity signed, track units per second
     * @param {{pinPoint:number, tight:number, loose:number}} [grades]
     */
    setVelocity(velocity, grades = SPEED_GRADE) {
        // Keyed on the thresholds themselves, so an equal copy of the grades never forces a relayout.
        const key = `${grades.pinPoint}/${grades.tight}/${grades.loose}`;
        if (this.meterDrawn !== key) {
            this.meterDrawn = key;
            const layout = stopMeterLayout(grades);
            for (const name of ['perfect', 'good', 'loose']) {
                const zone = this.meterZones[name];
                zone.setAttribute('x', layout[name].x.toFixed(1));
                zone.setAttribute('width', layout[name].width.toFixed(1));
            }
            if (this.meterLegend) {
                this.meterLegend.replaceChildren();
                for (const [shape, label, speed] of [
                    ['perfect', 'PERFECT', grades.pinPoint], ['good', 'GOOD', grades.tight], ['loose', 'LOOSE', grades.loose],
                ]) {
                    const item = document.createElement('span');
                    const icon = document.createElement('i');
                    icon.className = `shape shape--${shape}`;
                    item.append(icon, `${label} ≤${speed}`);
                    this.meterLegend.append(item);
                }
            }
        }
        const speed = Math.abs(velocity);
        write(this.velocityMarker, 'transform', `translate(${meterMarkerX(velocity, grades).toFixed(1)} 0)`);
        const state = speed <= grades.pinPoint ? 'pin' : (speed <= grades.tight ? 'tight' : (speed <= grades.loose ? 'loose' : 'fast'));
        write(this.velocityMarker, 'class', `hud__meter-marker hud__meter-marker--${state}`);
        write(this.velocityText, 'text', stopReadout(velocity));
        write(this.velocityText, 'class', speed <= grades.pinPoint ? 'is-planted' : '');
    }

    /**
     * Shows or hides the optional HUD elements from the settings.
     * @param {import('../Settings.js').Settings} settings
     */
    applyVisibility(settings) {
        this.palette = paletteFor(settings.get('judgementPalette'));
        this.beatCueOn = Boolean(settings.get('beatCue'));
        this.softCue = Boolean(settings.get('reducedFlash') || settings.get('reducedEffects'));
        if (this.beatCueEl) {
            this.beatCueEl.hidden = !this.beatCueOn;
            this.beatCueEl.classList.toggle('is-soft', this.softCue);
        }
        this.beatRing.setAttribute('visibility', settings.get('beatRing') ? 'visible' : 'hidden');
        const highway = this.find('noteHighway');
        if (highway) {
            // An <svg> has no .hidden property, so set the attribute itself.
            highway.toggleAttribute('hidden', !settings.get('noteHighway'));
        }
    }

    /**
     * The speed arc under the crosshair: fills with speed, acid at or below
     * the perfect-stop threshold, with ticks at the good and loose thresholds.
     * @param {{pinPoint:number, tight:number, loose:number}} grades SPEED_GRADE
     */
    setSpeedArc(velocity, maxSpeed, grades) {
        if (!this.arcFill) {
            return;
        }
        if (this.arcScale !== maxSpeed) {
            this.arcScale = maxSpeed;
            const marks = arcTickSpeeds(grades);
            for (const [name, speed] of Object.entries(marks)) {
                const angle = ((ARC_START_DEG - ARC_SPAN_DEG * arcFill(speed, maxSpeed)) * Math.PI) / 180;
                const tick = this.arcTicks[name];
                tick.setAttribute('x1', (Math.cos(angle) * (ARC_RADIUS - 3)).toFixed(2));
                tick.setAttribute('y1', (Math.sin(angle) * (ARC_RADIUS - 3)).toFixed(2));
                tick.setAttribute('x2', (Math.cos(angle) * (ARC_RADIUS + 3)).toFixed(2));
                tick.setAttribute('y2', (Math.sin(angle) * (ARC_RADIUS + 3)).toFixed(2));
            }
        }
        const fill = Math.max(0.5, arcFill(velocity, maxSpeed) * 100);
        write(this.arcFill, 'stroke-dasharray', `${fill.toFixed(1)} 100`);
        write(this.arcFill, 'stroke', arcColour(velocity, grades));
    }

    /** The perfect-stop flash; callers rate-limit it (FlashLimiter). */
    flashPerfect() {
        if (this.perfectFlash) {
            this.perfectFlash.classList.add('is-on');
            replayAnimations(this.perfectFlash);
        }
    }

    /** @param {number} progress 0..1 through the current beat */
    setBeat(progress) {
        write(this.beatRing, 'r', (11 + 28 * (1 - progress)).toFixed(2));
    }

    /**
     * Builds the lane strip for a level.
     * @param {number} count
     */
    buildLanes(count) {
        while (this.laneStrip.firstChild) {
            this.laneStrip.firstChild.remove();
        }
        this.laneRects = [];
        this.activeLane = undefined;
        const width = 600;
        const slot = width / count;
        for (let i = 0; i < count; i += 1) {
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(i * slot + 4));
            rect.setAttribute('y', '8');
            rect.setAttribute('width', String(slot - 8));
            rect.setAttribute('height', '18');
            rect.setAttribute('rx', '4');
            rect.setAttribute('class', 'hud__lane');
            this.laneStrip.append(rect);
            this.laneRects.push(rect);

            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('x', String(i * slot + slot / 2));
            label.setAttribute('y', '38');
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('class', 'hud__lane-label');
            label.textContent = String(i + 1);
            this.laneStrip.append(label);
        }
        const player = document.createElementNS(SVG_NS, 'rect');
        player.setAttribute('y', '4');
        player.setAttribute('width', '6');
        player.setAttribute('height', '26');
        player.setAttribute('rx', '2');
        player.setAttribute('class', 'hud__lane-player');
        this.laneStrip.append(player);
        this.lanePlayer = player;
    }

    /**
     * @param {number} activeIndex the lane the next note wants, or -1
     * @param {number} playerFraction 0..1 across the track
     */
    setLanes(activeIndex, playerFraction) {
        if (this.activeLane !== activeIndex) {
            this.activeLane = activeIndex;
            this.laneRects.forEach((rect, index) => {
                rect.setAttribute('class', index === activeIndex ? 'hud__lane hud__lane--active' : 'hud__lane');
            });
        }
        if (this.lanePlayer) {
            write(this.lanePlayer, 'x', (playerFraction * 600 - 3).toFixed(1));
        }
    }

    /**
     * @param {string} grade
     * @param {string} reason
     * @param {number} points
     * @param {boolean} bonus counter-strafe bonus earned
     * @param {{timingError?:number, headshot?:boolean}} [shot] timing error (s, negative = early) and head hit
     */
    showJudgement(grade, reason, points, bonus, shot = {}) {
        const plate = judgementPlate({
            grade, label: GRADE_LABEL[grade], timingError: shot.timingError, headshot: shot.headshot,
            reason: reason || (points ? `+${points}` : ''),
        });
        this.recent = pushRecent(this.recent, grade);
        this.renderRecent();
        this.csNote.classList.toggle('is-on', Boolean(bonus));
        this.paintPlate(plate);
    }

    /**
     * @param {string} label
     * @param {string} detail
     * @param {string} tone one of perfect/good/ok/miss/wild
     */
    flashJudgement(label, detail, tone) {
        this.paintPlate(judgementPlate({ grade: tone, label, reason: detail }));
    }

    paintPlate({ tone, label, ms, head, reason }) {
        this.judgeText.textContent = label;
        this.judgeMs.textContent = ms;
        this.judgeHead.hidden = !head;
        this.judgeReason.textContent = reason;
        this.judgeShape.className = `shape shape--${GRADE_SHAPE[tone] ?? 'miss'}`;
        this.judgeBox.className = `hud__judgement hud__judgement--${tone} is-live`;
        this.judgeText.style.color = this.palette[tone] ?? '';
        replayAnimations(this.judgeBox);
    }

    /** @param {boolean} headshot */
    flashBeat() {
        if (this.beatRing.getAttribute('class') !== 'hud__beat is-flash') {
            this.beatRing.setAttribute('class', 'hud__beat is-flash');   // write once; replays need no style recalc
        }
        replayAnimations(this.beatRing);
    }

    /** On-screen beat cue (an optional ring at the crosshair; soft, never a flash, under reduced flash). */
    pulseBeatCue(strong) {
        if (!this.beatCueOn || !this.beatCueEl) {
            return;
        }
        this.beatCueEl.classList.toggle('is-strong', strong);
        replayAnimations(this.beatCueEl);
    }

    /** @param {boolean} headshot @param {boolean} [soft] a static marker with no animation (reduced flash) */
    showHitmarker(headshot, soft = false) {
        // SVG elements expose className as a read-only animated string, so
        // the class is written as an attribute.
        if (soft) {
            this.hitmarker.setAttribute('class', `hud__hitmarker is-soft ${headshot ? 'is-head' : 'is-hit'}`);
            replayAnimations(this.hitmarker); // a non-flashing fade, replayed on every hit
            return;
        }
        this.hitmarker.setAttribute('class', `hud__hitmarker ${headshot ? 'is-head' : 'is-hit'}`);
        replayAnimations(this.hitmarker);
    }

    /** @param {string} text @param {boolean} visible */
    setCountdown(text, visible) {
        if (this.countdownText === text && this.countdownVisible === visible) {
            return;
        }
        this.countdownText = text;
        this.countdownVisible = visible;
        this.countdown.textContent = text;
        this.countdown.classList.toggle('is-visible', visible);
    }

    /**
     * Redraws the crosshair from the player's settings.
     * @param {import('../Settings.js').Settings} settings
     */
    applyCrosshair(settings) {
        Hud.drawCrosshair(this.crosshair, settings);
    }

    /**
     * Draws a crosshair into any SVG that has four <line>s and a <circle>,
     * so the settings panel can show a live preview with the same code.
     * @param {SVGElement} svg
     * @param {import('../Settings.js').Settings} settings
     */
    static drawCrosshair(svg, settings) {
        const length = settings.get('crosshairLength');
        const gap = settings.get('crosshairGap');
        const thickness = settings.get('crosshairThickness');
        const colour = settings.get('crosshairColour');
        const dot = settings.get('crosshairDot');

        const lines = svg.querySelectorAll('line');
        const coords = [
            [-gap, 0, -gap - length, 0],
            [gap, 0, gap + length, 0],
            [0, -gap, 0, -gap - length],
            [0, gap, 0, gap + length],
        ];
        lines.forEach((line, index) => {
            const [x1, y1, x2, y2] = coords[index];
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            line.setAttribute('stroke', colour);
            line.setAttribute('stroke-width', String(thickness));
        });
        const centre = svg.querySelector('circle');
        centre.setAttribute('r', dot ? String(Math.max(1, thickness * 0.7)) : '0');
        centre.setAttribute('fill', colour);
    }
}
