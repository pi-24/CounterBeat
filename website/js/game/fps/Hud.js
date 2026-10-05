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
 */
import { GRADE_LABEL } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
        /** @type {Map<object, SVGElement>} note -> its marker on the highway */
        this.highwayMarkers = new Map();
        this.highwayLines = [];
        this.highwayLanes = 1;
    }

    /** @param {string} text an instruction line; empty hides it. */
    setHint(text) {
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
    }

    /**
     * @param {object[]} notes the chart
     * @param {number} songTime
     * @param {number} secondsPerBeat
     */
    updateHighway(notes, songTime, secondsPerBeat) {
        const lookahead = 4 * secondsPerBeat;
        const height = 110;
        const slot = 600 / this.highwayLanes;

        // Beat grid lines scroll down with the music.
        const nextBeat = Math.ceil(songTime / secondsPerBeat) * secondsPerBeat;
        this.highwayLines.forEach((line, i) => {
            const remaining = nextBeat + i * secondsPerBeat - songTime;
            const y = height - (remaining / lookahead) * height;
            line.setAttribute('y1', String(y));
            line.setAttribute('y2', String(y));
            line.setAttribute('opacity', remaining <= lookahead ? '1' : '0');
        });

        let first = true;
        for (const note of notes) {
            const remaining = note.time - songTime;
            const marker = this.highwayMarkers.get(note);
            if (note.resolved || remaining > lookahead || remaining < -0.05) {
                if (marker) {
                    marker.remove();
                    this.highwayMarkers.delete(note);
                }
                continue;
            }
            let node = marker;
            if (!node) {
                node = document.createElementNS(SVG_NS, 'circle');
                node.setAttribute('cx', String(note.lane * slot + slot / 2));
                node.setAttribute('r', '9');
                this.highway.append(node);
                this.highwayMarkers.set(note, node);
            }
            const y = height - (Math.max(0, remaining) / lookahead) * height;
            node.setAttribute('cy', String(y));
            node.setAttribute('class', first ? 'hud__highway-note hud__highway-note--next' : 'hud__highway-note');
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
        this.progressText.textContent = `Bot ${judged}/${total}  •  ${this.bpm} BPM`;
    }

    /** @param {number} score @param {number} combo @param {number} multiplier */
    setScore(score, combo, multiplier) {
        this.scoreText.textContent = score.toLocaleString('en-GB');
        this.comboText.textContent = combo >= 2 ? `${combo} COMBO  ×${multiplier.toFixed(2)}` : '';
    }

    /** @param {number} fraction 0..1 */
    setAccuracy(fraction) {
        this.accuracyText.textContent = `${(fraction * 100).toFixed(1)}%`;
    }

    /** @param {number} fraction 0..1 */
    setFocus(fraction) {
        this.focusFill.setAttribute('width', String(Math.max(0, Math.min(1, fraction)) * 1000));
        const state = fraction > 0.5 ? 'ok' : (fraction > 0.25 ? 'warn' : 'danger');
        this.focusFill.setAttribute('class', `hud__focus-fill hud__focus-fill--${state}`);
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
        const ratio = Math.max(-1, Math.min(1, velocity / maxSpeed));
        const markerX = half + ratio * half;
        const speed = Math.abs(velocity);

        const pinHalf = (pinPoint / maxSpeed) * half;
        const tightHalf = (tight / maxSpeed) * half;
        this.velocityPin.setAttribute('x', String(half - pinHalf));
        this.velocityPin.setAttribute('width', String(Math.max(pinHalf * 2, 4)));
        this.velocityTight.setAttribute('x', String(half - tightHalf));
        this.velocityTight.setAttribute('width', String(tightHalf * 2));

        this.velocityMarker.setAttribute('x', String(markerX - 3));
        const state = speed <= pinPoint ? 'pin' : (speed <= tight ? 'tight' : 'fast');
        this.velocityMarker.setAttribute('class', `hud__velocity-marker hud__velocity-marker--${state}`);

        this.velocityText.textContent = speed <= pinPoint ? 'PLANTED — FIRE' : `${Math.round(speed)} u/s`;
        this.velocityText.className = `hud__velocity-text${speed <= pinPoint ? ' is-planted' : ''}`;
    }

    /** @param {number} progress 0..1 through the current beat */
    setBeat(progress) {
        const radius = 11 + 28 * (1 - progress);
        this.beatRing.setAttribute('r', String(radius));
        this.beatRing.setAttribute('opacity', String(0.15 + 0.5 * progress));
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
        this.laneRects.forEach((rect, index) => {
            rect.setAttribute('class', index === activeIndex ? 'hud__lane hud__lane--active' : 'hud__lane');
        });
        if (this.lanePlayer) {
            this.lanePlayer.setAttribute('x', String(playerFraction * 600 - 3));
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
        this.judgeBox.className = `hud__judgement hud__judgement--${tone}`;
        // Restart the CSS animation by forcing a reflow between class swaps.
        void this.judgeBox.offsetWidth;
        this.judgeBox.classList.add('is-live');
    }

    /** @param {boolean} headshot */
    showHitmarker(headshot) {
        // SVG elements expose className as a read-only animated string, so
        // the class is written as an attribute.
        this.hitmarker.setAttribute('class', 'hud__hitmarker');
        void this.hitmarker.getBoundingClientRect();
        this.hitmarker.setAttribute('class', `hud__hitmarker ${headshot ? 'is-head' : 'is-hit'}`);
    }

    /** @param {string} text @param {boolean} visible */
    setCountdown(text, visible) {
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
