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
import { APPROACH_BEATS, GRADE_LABEL } from '../rules/config.js';

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
        this.progressText = this.find('hudProgress');
        this.scoreText = this.find('hudScore');
        this.comboText = this.find('hudCombo');
        this.accuracyText = this.find('hudAccuracy');
        this.focusFill = this.find('focusFill');
        this.beatRing = this.find('beatRing');
        this.judgeBox = this.find('judgement');
        this.judgeText = this.find('judgeText');
        this.judgeReason = this.find('judgeReason');
        this.countdown = this.find('countdown');
        this.hitmarker = this.find('hitmarker');
        this.crosshair = this.find('crosshair');
        this.laneStrip = this.find('laneStrip');
        this.velocitySvg = this.find('velocity');
        this.velocityText = this.find('velocityText');

        this.velocityMarker = this.velocitySvg.querySelector('[data-part="marker"]');
        this.velocityTight = this.velocitySvg.querySelector('[data-part="tight"]');
        this.velocityPin = this.velocitySvg.querySelector('[data-part="pin"]');

        this.hint = this.find('hudHint');
        this.highway = this.find('noteHighway');

        this.laneRects = [];
        this.lanePlayer = null;
        this.activeLane = undefined;
        /** @type {Map<object, SVGElement>} note -> its marker on the highway */
        this.highwayMarkers = new Map();
        this.highwayLines = [];
        this.highwayLanes = 1;
        /** The maximum speed the velocity bands were last drawn for. */
        this.velocityScale = 0;
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
        const spawnLabel = document.createElementNS(SVG_NS, 'text');
        spawnLabel.setAttribute('x', '596');
        spawnLabel.setAttribute('y', String(Number(spawnY) - 4));
        spawnLabel.setAttribute('text-anchor', 'end');
        spawnLabel.setAttribute('class', 'hud__highway-spawn-label');
        spawnLabel.textContent = 'bots step out';
        this.highway.append(spawnLine, spawnLabel);
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

    /** @param {string} name @param {number} bpm */
    setLevel(name, bpm) {
        this.levelText.textContent = name;
        this.bpm = bpm;
    }

    /** @param {number} judged @param {number} total */
    setProgress(judged, total) {
        write(this.progressText, 'text', `Bot ${judged}/${total}  •  ${this.bpm} BPM`);
    }

    /** @param {number} score @param {number} combo @param {number} multiplier */
    setScore(score, combo, multiplier) {
        write(this.scoreText, 'text', score.toLocaleString('en-GB'));
        write(this.comboText, 'text', combo >= 2 ? `${combo} COMBO  ×${multiplier.toFixed(2)}` : '');
    }

    /** @param {number} fraction 0..1 */
    setAccuracy(fraction) {
        write(this.accuracyText, 'text', `${(fraction * 100).toFixed(1)}%`);
    }

    /** @param {number} fraction 0..1 */
    setFocus(fraction) {
        write(this.focusFill, 'width', String(Math.max(0, Math.min(1, fraction)) * 1000));
        const state = fraction > 0.5 ? 'ok' : (fraction > 0.25 ? 'warn' : 'danger');
        write(this.focusFill, 'class', `hud__focus-fill hud__focus-fill--${state}`);
    }

    /**
     * @param {number} velocity signed, track units per second
     * @param {number} maxSpeed
     * @param {number} pinPoint
     * @param {number} tight
     */
    setVelocity(velocity, maxSpeed, pinPoint, tight) {
        const width = 420;
        const half = width / 2;

        // The bands only depend on the run's top speed: draw them once.
        if (this.velocityScale !== maxSpeed) {
            this.velocityScale = maxSpeed;
            const pinHalf = (pinPoint / maxSpeed) * half;
            const tightHalf = (tight / maxSpeed) * half;
            this.velocityPin.setAttribute('x', String(half - pinHalf));
            this.velocityPin.setAttribute('width', String(Math.max(pinHalf * 2, 4)));
            this.velocityTight.setAttribute('x', String(half - tightHalf));
            this.velocityTight.setAttribute('width', String(tightHalf * 2));
        }

        const ratio = Math.max(-1, Math.min(1, velocity / maxSpeed));
        const speed = Math.abs(velocity);
        write(this.velocityMarker, 'x', (half + ratio * half - 3).toFixed(1));
        const state = speed <= pinPoint ? 'pin' : (speed <= tight ? 'tight' : 'fast');
        write(this.velocityMarker, 'class', `hud__velocity-marker hud__velocity-marker--${state}`);

        const planted = speed <= pinPoint;
        write(this.velocityText, 'text', planted ? 'PLANTED · FIRE' : `${Math.round(speed)} u/s`);
        write(this.velocityText, 'class', `hud__velocity-text${planted ? ' is-planted' : ''}`);
    }

    /**
     * Shows or hides the optional HUD elements from the settings.
     * @param {import('../Settings.js').Settings} settings
     */
    applyVisibility(settings) {
        this.beatRing.setAttribute('visibility', settings.get('beatRing') ? 'visible' : 'hidden');
        const highway = this.find('noteHighway');
        if (highway) {
            // An <svg> has no .hidden property, so set the attribute itself.
            highway.toggleAttribute('hidden', !settings.get('noteHighway'));
        }
    }

    /** @param {number} progress 0..1 through the current beat */
    setBeat(progress) {
        write(this.beatRing, 'r', (11 + 28 * (1 - progress)).toFixed(2));
        write(this.beatRing, 'opacity', (0.15 + 0.5 * progress).toFixed(3));
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
     */
    showJudgement(grade, reason, points, bonus) {
        const label = bonus ? `${GRADE_LABEL[grade]}  +CS` : GRADE_LABEL[grade];
        this.flashJudgement(label, reason || (points ? `+${points}` : ''), grade);
    }

    /**
     * @param {string} label
     * @param {string} detail
     * @param {string} tone one of perfect/good/ok/miss/wild
     */
    flashJudgement(label, detail, tone) {
        this.judgeText.textContent = label;
        this.judgeReason.textContent = detail;
        this.judgeBox.className = `hud__judgement hud__judgement--${tone} is-live`;
        replayAnimations(this.judgeBox);
    }

    /** @param {boolean} headshot */
    showHitmarker(headshot) {
        // SVG elements expose className as a read-only animated string, so
        // the class is written as an attribute.
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
