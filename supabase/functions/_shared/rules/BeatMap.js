/**
 * BeatMap.js
 *
 * Turns a chart definition (see charts.js) into playable notes.
 *
 * The notes are generated rather than hand-authored, but they are generated
 * from a fixed seed so a level is identical every time it is played, and the
 * lane for each note is only chosen from the lanes the player could actually
 * reach in the time available - which the movement model is asked directly.
 */
import { LAYOUT } from './config.js';
import { CounterStrafeBody } from './CounterStrafeBody.js';

/** Seconds trimmed from every dash budget, see chooseLane. */
const REACTION_ALLOWANCE = 0.04;

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
    /** @param {object} level a chart definition from charts.js. */
    constructor(level) {
        this.level = level;
        this.lanes = new Lanes(level.lanes, level.trackScale ?? 1, level.laneInset);
        this.secondsPerBeat = 60 / level.bpm;
        this.notes = this.generate();
        /** Index of the next note that has not been spawned yet. */
        this.spawnCursor = 0;
        /** Index of the earliest note that might still be unresolved. */
        this.pendingCursor = 0;
    }

    /**
     * Spawns, in order, every note whose approach has begun by `songTime`.
     * Notes are sorted by time, so this only ever looks at the next few.
     * @param {number} songTime
     * @param {number} leadSeconds how long before its beat a note appears
     * @param {(note: Note) => void} [onSpawn]
     */
    spawnDue(songTime, leadSeconds, onSpawn) {
        const notes = this.notes;
        while (this.spawnCursor < notes.length) {
            const note = notes[this.spawnCursor];
            if (note.time - songTime > leadSeconds) {
                break;
            }
            this.spawnCursor += 1;
            if (!note.spawned && !note.resolved) {
                note.spawned = true;
                if (onSpawn) {
                    onSpawn(note);
                }
            }
        }
    }

    /**
     * Hands every spawned, unresolved note whose window closed before
     * `songTime` to `onExpire`, which must resolve it.
     * @param {number} songTime
     * @param {number} windowSeconds the chart's widest timing window
     * @param {(note: Note) => void} onExpire
     */
    expireDue(songTime, windowSeconds, onExpire) {
        const notes = this.notes;
        for (let i = this.pendingCursor; i < notes.length; i += 1) {
            const note = notes[i];
            if (songTime <= note.time + windowSeconds) {
                break;
            }
            if (note.spawned && !note.resolved) {
                onExpire(note);
            }
        }
        this.skipResolved();
    }

    /** @returns {Note | null} the earliest unresolved note, or null when the chart is done. */
    get nextNote() {
        this.skipResolved();
        return this.notes[this.pendingCursor] ?? null;
    }

    /** @returns {boolean} whether any note is on screen and still waiting for a shot. */
    get hasLiveNote() {
        const notes = this.notes;
        for (let i = this.pendingCursor; i < this.spawnCursor; i += 1) {
            if (notes[i].spawned && !notes[i].resolved) {
                return true;
            }
        }
        return false;
    }

    /** Moves the pending cursor past notes that have already been judged. */
    skipResolved() {
        const notes = this.notes;
        while (this.pendingCursor < notes.length && notes[this.pendingCursor].resolved) {
            this.pendingCursor += 1;
        }
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
        const patterns = level.patterns ?? [level.pattern];
        const gridOffset = level.gridOffset ?? 0;

        for (let bar = level.firstNoteBar; bar < level.bars; bar += 1) {
            // Mostly the main pattern, now and then its variation, so a chart
            // has phrases rather than one loop - still fixed by the seed.
            const pattern = patterns.length > 1 && random.next() < 0.3 ? patterns[1] : patterns[0];
            for (const offset of pattern) {
                const time = gridOffset + (bar * 4 + offset) * spb;

                // 80% of the gap less a reaction allowance: the player needs
                // a moment to react to the lane lighting up and a frame to
                // time the stop, so the chart never demands a perfect dash at
                // the physical limit.
                const available = (time - previousTime) * 0.8 - REACTION_ALLOWANCE;
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
