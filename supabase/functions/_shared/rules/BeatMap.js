/**
 * BeatMap.js
 *
 * Turns a level definition into a playable chart.
 *
 * The notes are generated rather than hand-authored, but they are generated
 * from a fixed seed so a level is identical every time it is played, and the
 * lane for each note is only chosen from the lanes the player could actually
 * reach in the time available - which the movement model is asked directly.
 */
import { LAYOUT } from './config.js';
import { CounterStrafeBody } from './CounterStrafeBody.js';

/** A tiny deterministic generator so charts are reproducible. */
class SeededRandom {
    /** @param {number} seed */
    constructor(seed) {
        this.state = (seed >>> 0) || 1;
    }

    /** @returns {number} a float in [0, 1). */
    next() {
        // xorshift32
        let x = this.state;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.state = x >>> 0;
        return this.state / 0x100000000;
    }

    /** @param {number} count @returns {number} an integer in [0, count). */
    int(count) {
        return Math.floor(this.next() * count);
    }

    /** @template T @param {T[]} items @returns {T} */
    pick(items) {
        return items[this.int(items.length)];
    }
}

export class Note {
    /**
     * @param {number} index
     * @param {number} time seconds from the start of the track.
     * @param {number} lane lane index.
     */
    constructor(index, time, lane) {
        this.index = index;
        this.time = time;
        this.lane = lane;
        /** Set once the note has been judged so it is never scored twice. */
        this.resolved = false;
        /** Set when the scene has created the sprite for this note. */
        this.spawned = false;
        this.grade = null;
    }
}

export class Lanes {
    /**
     * @param {number} count
     * @param {number} [scale] fraction of the full track the lanes occupy.
     *   Later levels pack more lanes into a narrower strip, which shrinks the
     *   stopping zones without making the dashes between them impossible.
     * @param {number} [inset] fraction of a lane slot that counts as standing
     *   in it, so later levels demand a more precise stop.
     */
    constructor(count, scale = 1, inset = LAYOUT.laneInset) {
        const full = LAYOUT.trackRight - LAYOUT.trackLeft;
        const middle = (LAYOUT.trackLeft + LAYOUT.trackRight) / 2;

        this.count = count;
        this.left = middle - (full * scale) / 2;
        this.right = middle + (full * scale) / 2;
        this.width = (this.right - this.left) / count;
        this.halfZone = (this.width / 2) * inset;
    }

    /** @param {number} index @returns {number} the lane's centre in pixels. */
    centre(index) {
        return this.left + (index + 0.5) * this.width;
    }

    /**
     * @param {number} index
     * @param {number} x
     * @returns {boolean} whether x counts as standing inside the lane.
     */
    contains(index, x) {
        return Math.abs(x - this.centre(index)) <= this.halfZone;
    }

    /** @param {number} a @param {number} b @returns {number} pixels apart. */
    distance(a, b) {
        return Math.abs(this.centre(a) - this.centre(b));
    }
}

export class BeatMap {
    /** @param {object} level a level definition from levels.js. */
    constructor(level) {
        this.level = level;
        this.lanes = new Lanes(level.lanes, level.trackScale ?? 1, level.laneInset);
        this.secondsPerBeat = 60 / level.bpm;
        this.notes = this.generate();
    }

    /** @returns {number} the time of the final note plus a short tail. */
    get duration() {
        const last = this.notes[this.notes.length - 1];
        return (last ? last.time : 0) + this.secondsPerBeat * 4;
    }

    /** @returns {Note[]} */
    generate() {
        const level = this.level;
        const random = new SeededRandom(level.seed);
        const spb = this.secondsPerBeat;
        const notes = [];

        // The bar the chart starts on gives the music a short intro and gives
        // the player a moment to read the lane layout.
        let previousLane = Math.floor(level.lanes / 2);
        let previousTime = Number.NEGATIVE_INFINITY;
        let index = 0;

        for (let bar = level.firstNoteBar; bar < level.bars; bar += 1) {
            for (const offset of level.pattern) {
                const time = (bar * 4 + offset) * spb;

                // 80% of the gap: the player needs a moment to react to the
                // lane lighting up, so the chart never demands a perfect
                // reaction at the physical limit.
                const available = (time - previousTime) * 0.8;
                const lane = this.chooseLane(previousLane, available, random);

                notes.push(new Note(index, time, lane));
                index += 1;
                previousLane = lane;
                previousTime = time;
            }
        }
        return notes;
    }

    /**
     * Picks the next lane: a different one whenever the player could get
     * there in time, otherwise the lane they are already standing in, which
     * reads as a rhythmic double rather than an impossible dash.
     *
     * @param {number} fromLane
     * @param {number} availableSeconds
     * @param {SeededRandom} random
     * @returns {number}
     */
    chooseLane(fromLane, availableSeconds, random) {
        if (!Number.isFinite(availableSeconds)) {
            return fromLane;
        }
        const reach = CounterStrafeBody.maxDistance(this.level.movement, availableSeconds);
        const candidates = [];

        for (let lane = 0; lane < this.lanes.count; lane += 1) {
            if (lane === fromLane) {
                continue;
            }
            if (this.lanes.distance(fromLane, lane) <= reach) {
                candidates.push(lane);
            }
        }

        if (candidates.length === 0) {
            return fromLane;
        }
        // Prefer a neighbouring lane most of the time so the chart flows,
        // but occasionally ask for a longer dash.
        const neighbours = candidates.filter((lane) => Math.abs(lane - fromLane) === 1);
        if (neighbours.length > 0 && random.next() < 0.7) {
            return random.pick(neighbours);
        }
        return random.pick(candidates);
    }

    /**
     * @param {number} songTime
     * @param {number} windowSeconds
     * @returns {Note | null} the unresolved note closest to `songTime`.
     */
    findNoteNear(songTime, windowSeconds) {
        let best = null;
        let bestDelta = Number.POSITIVE_INFINITY;

        for (const note of this.notes) {
            if (note.resolved) {
                continue;
            }
            const delta = Math.abs(note.time - songTime);
            if (delta > windowSeconds) {
                continue;
            }
            if (delta < bestDelta) {
                best = note;
                bestDelta = delta;
            }
        }
        return best;
    }

    /** @returns {number} how many notes the chart contains. */
    get total() {
        return this.notes.length;
    }
}
