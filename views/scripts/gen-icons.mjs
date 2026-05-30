/**
 * gen-icons.mjs — generates the PWA icon set as real PNGs with zero deps
 * (pure Node + zlib). Brand: vertical purple→violet gradient with a white "F".
 * Re-run with `node scripts/gen-icons.mjs` if the brand changes.
 *
 * Outputs into public/icons: icon-192.png, icon-512.png, maskable-512.png,
 * apple-touch-icon.png (180), and favicon-32.png.
 */
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

const TOP = [0x7c, 0x3a, 0xed];  // #7c3aed
const BOT = [0xa8, 0x55, 0xf7];  // #a855f7
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Is (x,y) inside the block letter "F" for a canvas of side S?
function inF(x, y, S) {
    const r = (x0, y0, x1, y1) => x >= x0 * S && x < x1 * S && y >= y0 * S && y < y1 * S;
    return (
        r(0.34, 0.26, 0.45, 0.76) ||   // vertical stem
        r(0.34, 0.26, 0.70, 0.37) ||   // top bar
        r(0.34, 0.47, 0.62, 0.57)      // middle bar
    );
}

function png(size, { letter = true } = {}) {
    const raw = Buffer.alloc(size * (size * 4 + 1)); // +1 filter byte per row
    let p = 0;
    for (let y = 0; y < size; y++) {
        raw[p++] = 0; // filter: none
        const t = y / (size - 1);
        const bg = [lerp(TOP[0], BOT[0], t), lerp(TOP[1], BOT[1], t), lerp(TOP[2], BOT[2], t)];
        for (let x = 0; x < size; x++) {
            if (letter && inF(x, y, size)) {
                raw[p++] = 0xff; raw[p++] = 0xff; raw[p++] = 0xff; raw[p++] = 0xff;
            } else {
                raw[p++] = bg[0]; raw[p++] = bg[1]; raw[p++] = bg[2]; raw[p++] = 0xff;
            }
        }
    }

    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
        const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const files = {
    "icon-192.png": png(192),
    "icon-512.png": png(512),
    "maskable-512.png": png(512),     // full-bleed gradient → safe under masks
    "apple-touch-icon.png": png(180),
    "favicon-32.png": png(32),
};
for (const [name, buf] of Object.entries(files)) {
    writeFileSync(join(OUT, name), buf);
    console.log(`wrote public/icons/${name} (${buf.length} bytes)`);
}
