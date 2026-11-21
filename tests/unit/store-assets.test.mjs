import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import {
    readPngHeader, alphaStats, crc32, pngCorruption, checkCutList, checkStoreText, checkStoreAssets,
    REQUIRED_CAPSULES, SHORT_DESCRIPTION_MAX,
} from '../../tools/check-store-assets.mjs';

/** A minimal 8-bit PNG (filter 0) whose pixels come from fn(x, y) -> [r,g,b,a]. */
function makePng(width, height, colorType, fn = () => [10, 20, 30, 255], bitDepth = 8) {
    const channels = colorType === 6 ? 4 : 3;
    const raw = Buffer.alloc(height * (width * channels + 1));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = fn(x, y);
            for (let c = 0; c < channels; c++) raw[y * (width * channels + 1) + 1 + x * channels + c] = px[c];
        }
    }
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = bitDepth; head[9] = colorType;
    const chunk = (type, data) => {
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
        out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
        return out;
    };
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('readPngHeader reads size and colour type, and rejects non-PNG data', () => {
    const head = readPngHeader(makePng(7, 5, 6));
    assert.deepEqual([head.width, head.height, head.colorType], [7, 5, 6]);
    assert.equal(readPngHeader(Buffer.from('not a png at all, definitely not a png file here')), null);
});

test('alphaStats counts transparent and opaque pixels', () => {
    const s = alphaStats(makePng(10, 10, 6, (x) => (x < 4 ? [0, 0, 0, 0] : [255, 255, 255, 255])));
    assert.equal(s.transparent, 40);
    assert.equal(s.opaque, 60);
});

const ROWS = (spans) => spans.map(([a, b], i) => `| ${i + 1} | ${a}-${b} | x | shot | src | beat marker |`).join('\n');

test('trailer cut list: contiguous, 30-60 s, with beat markers', () => {
    const ok = ROWS([['0:00', '0:08'], ['0:08', '0:16'], ['0:16', '0:24'], ['0:24', '0:32'], ['0:32', '0:40']]);
    const r = checkCutList(ok);
    assert.deepEqual(r.problems, []);
    assert.equal(r.seconds, 40);
});

test('trailer cut list rejects gaps, short runtime and long runtime', () => {
    const gap = checkCutList(ROWS([['0:00', '0:08'], ['0:09', '0:16'], ['0:16', '0:24'], ['0:24', '0:32'], ['0:32', '0:40']]));
    assert.ok(gap.problems.some((p) => /starts at 9s/.test(p)));
    const short = checkCutList(ROWS([['0:00', '0:05'], ['0:05', '0:10'], ['0:10', '0:15'], ['0:15', '0:20'], ['0:20', '0:25']]));
    assert.ok(short.problems.some((p) => /outside 30-60s/.test(p)));
    const long = checkCutList(ROWS([['0:00', '0:20'], ['0:20', '0:30'], ['0:30', '0:40'], ['0:40', '0:50'], ['0:50', '1:10']]));
    assert.ok(long.problems.some((p) => /outside 30-60s/.test(p)));
});

test('store text needs both sections and a short description within the Steam limit', () => {
    const long = 'x'.repeat(450);
    assert.deepEqual(checkStoreText(`## Short description\n\n> Strafe and shoot.\n\n## Long description\n\n${long}\n`), []);
    const tooLong = checkStoreText(`## Short description\n\n${'y'.repeat(SHORT_DESCRIPTION_MAX + 1)}\n\n## Long description\n\n${long}\n`);
    assert.ok(tooLong.some((p) => /short description is/.test(p)));
    assert.ok(checkStoreText('nothing here').length >= 2);
});

test('checkStoreAssets passes on the real repo and fails on a wrong size or a missing logo alpha', () => {
    const real = checkStoreAssets();
    assert.deepEqual(real.problems, []);

    const root = mkdtempSync(path.join(tmpdir(), 'cb-store-'));
    mkdirSync(path.join(root, 'store', 'capsules'), { recursive: true });
    mkdirSync(path.join(root, 'store', 'screenshots'), { recursive: true });
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    for (const f of ['trailer-cutlist.md', 'store-text-draft.md', 'steam-handoff.md']) cpSync(path.join('docs', f), path.join(root, 'docs', f));
    for (const c of REQUIRED_CAPSULES) {
        // wrong height for the header, an opaque RGBA logo, small valid files otherwise are not possible at full size, so check only the two faults
        if (c.file === 'header.png') writeFileSync(path.join(root, 'store', 'capsules', c.file), makePng(c.width, c.height - 1, 2));
        if (c.file === 'library-logo.png') writeFileSync(path.join(root, 'store', 'capsules', c.file), makePng(c.width, c.height, 6));
    }
    const { problems } = checkStoreAssets(root);
    assert.ok(problems.some((p) => /header capsule: .*is 920x429, needs 920x430/.test(p)));
    assert.ok(problems.some((p) => /library logo: only .* transparent/.test(p)));
    assert.ok(problems.some((p) => /small capsule: missing/.test(p)));
    assert.ok(problems.some((p) => /screenshots: 0 valid/.test(p)));
});

test('crc32 matches the PNG reference value and pngCorruption spots damage', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    const good = makePng(4, 4, 2);
    assert.equal(pngCorruption(good), null);
    const flipped = Buffer.from(good);
    flipped[flipped.length - 20] ^= 0xff; // inside IDAT
    assert.match(pngCorruption(flipped), /bad CRC/);
    assert.match(pngCorruption(good.subarray(0, good.length - 12)), /IEND|truncated/);
});

test('an unreadable logo (16-bit RGBA) is a clean FAIL line, not a thrown error', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-store-'));
    mkdirSync(path.join(root, 'store', 'capsules'), { recursive: true });
    const logo = REQUIRED_CAPSULES.find((c) => c.alpha);
    // a 16-bit RGBA header with a matching size; the data is never decoded because alphaStats rejects the depth
    writeFileSync(path.join(root, 'store', 'capsules', logo.file), makePng(logo.width, logo.height, 6, () => [0, 0, 0, 0], 16));
    const { problems } = checkStoreAssets(root);
    assert.ok(problems.some((p) => /library logo: cannot read the alpha channel/.test(p)), problems.join(' | '));
});
