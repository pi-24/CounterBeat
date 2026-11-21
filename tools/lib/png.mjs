/**
 * png.mjs - minimal 8-bit PNG encoder and image helpers for tools/build-art.mjs
 * (no third-party dependency).  Decoding lives in tools/validate-assets.mjs.
 */
import { deflateSync } from 'node:zlib';

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
};

/** @param {{width:number,height:number,data:Uint8Array}} img RGBA pixels; hasAlpha=false writes RGB. */
export function encodePng({ width, height, data }, hasAlpha = true) {
    const ch = hasAlpha ? 4 : 3;
    const raw = Buffer.alloc((width * ch + 1) * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const s = (y * width + x) * 4;
            const o = y * (width * ch + 1) + 1 + x * ch;
            raw[o] = data[s]; raw[o + 1] = data[s + 1]; raw[o + 2] = data[s + 2];
            if (hasAlpha) raw[o + 3] = data[s + 3];
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = hasAlpha ? 6 : 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Converts a decodePng() result (1-4 channels) to RGBA. */
export function toRgba(img) {
    if (img.channels === 4) return { width: img.width, height: img.height, data: img.data };
    const data = new Uint8Array(img.width * img.height * 4);
    const grey = img.channels <= 2;
    for (let i = 0; i < img.width * img.height; i++) {
        const o = i * img.channels;
        data[i * 4] = img.data[o];
        data[i * 4 + 1] = grey ? img.data[o] : img.data[o + 1];
        data[i * 4 + 2] = grey ? img.data[o] : img.data[o + 2];
        data[i * 4 + 3] = img.channels === 2 ? img.data[o + 1] : 255;
    }
    return { width: img.width, height: img.height, data };
}

/** Alpha-weighted box-filter downscale. */
export function resize(img, w, h) {
    const out = new Uint8Array(w * h * 4);
    const sx = img.width / w;
    const sy = img.height / h;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
            const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
            const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
            for (let yy = y0; yy < y1; yy++) {
                for (let xx = x0; xx < x1; xx++) {
                    const o = (Math.min(yy, img.height - 1) * img.width + Math.min(xx, img.width - 1)) * 4;
                    const al = img.data[o + 3];
                    r += img.data[o] * al; g += img.data[o + 1] * al; b += img.data[o + 2] * al; a += al; n++;
                }
            }
            const o = (y * w + x) * 4;
            if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
            out[o + 3] = n ? a / n : 0;
        }
    }
    return { width: w, height: h, data: out };
}
