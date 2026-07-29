/**
 * PWA アイコンを生成する（依存ライブラリなし）。
 *   node scripts/generate-icons.mjs
 *
 * デザインツールを使わずに済むよう、湯気の立つ器のシルエットを
 * ピクセル単位で描いて PNG に書き出している。差し替えたくなったら
 * public/icons/ の PNG を好きな画像に置き換えるだけでよい。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const PRIMARY = [240, 131, 74]; // #f0834a
const WHITE = [255, 255, 255];

// ── PNG エンコーダ ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 各行の先頭にフィルタタイプ（0 = None）を置く
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 図形 ──────────────────────────────────────────────────────────────────────
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
};

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/**
 * @param {number} size
 * @param {{ bg: number[]|null, fg: number[], pad: number }} opts
 *   pad: 図柄をどれだけ内側に寄せるか（maskable のセーフゾーン用）
 */
function drawIcon(size, { bg, fg, pad = 0 }) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 3; // 3x3 スーパーサンプリングで縁を滑らかにする
  const inner = size * (1 - pad * 2);
  const off = size * pad;

  // 図柄（0〜1 の相対座標で定義）
  const shape = (u, v) => {
    // 湯気
    if (inRoundedRect(u, v, 0.40, 0.16, 0.445, 0.34, 0.023)) return true;
    if (inRoundedRect(u, v, 0.555, 0.16, 0.60, 0.34, 0.023)) return true;
    // 器のふち
    if (inRoundedRect(u, v, 0.15, 0.44, 0.85, 0.51, 0.035)) return true;
    // 器の身（下半円）
    if (v >= 0.51 && inCircle(u, v, 0.5, 0.51, 0.30)) return true;
    return false;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const u = (x + (sx + 0.5) / S - off) / inner;
          const v = (y + (sy + 0.5) / S - off) / inner;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && shape(u, v)) hits += 1;
        }
      }
      const coverage = hits / (S * S);
      const i = (y * size + x) * 4;

      if (bg) {
        // 背景の上に前景を合成する
        rgba[i] = Math.round(bg[0] * (1 - coverage) + fg[0] * coverage);
        rgba[i + 1] = Math.round(bg[1] * (1 - coverage) + fg[1] * coverage);
        rgba[i + 2] = Math.round(bg[2] * (1 - coverage) + fg[2] * coverage);
        rgba[i + 3] = 255;
      } else {
        // 透明背景（バッジ用のモノクロアイコン）
        rgba[i] = fg[0];
        rgba[i + 1] = fg[1];
        rgba[i + 2] = fg[2];
        rgba[i + 3] = Math.round(255 * coverage);
      }
    }
  }
  return encodePng(size, size, rgba);
}

/** 角丸の背景を持つアイコン（通常アイコン用） */
function withRoundedBackground(size, radiusRatio) {
  const base = drawIcon(size, { bg: PRIMARY, fg: WHITE });
  if (radiusRatio <= 0) return base;
  return base; // 角丸はOS側で処理されるため、ここでは正方形のままにする
}

mkdirSync(OUT_DIR, { recursive: true });

const files = [
  ["icon-192.png", withRoundedBackground(192, 0)],
  ["icon-512.png", withRoundedBackground(512, 0)],
  // maskable は外周20%が切り取られうるので、図柄を内側に寄せる
  ["maskable-512.png", drawIcon(512, { bg: PRIMARY, fg: WHITE, pad: 0.14 })],
  ["apple-touch-icon.png", drawIcon(180, { bg: PRIMARY, fg: WHITE })],
  // Android の通知バッジは白抜きのモノクロで表示される
  ["badge.png", drawIcon(96, { bg: null, fg: WHITE })],
];

for (const [name, buffer] of files) {
  writeFileSync(join(OUT_DIR, name), buffer);
  console.log(`generated: public/icons/${name} (${buffer.length} bytes)`);
}
