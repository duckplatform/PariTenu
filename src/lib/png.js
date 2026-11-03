// PNG sans dépendance : lire, recadrer et réduire, écrire. Sert à alléger les photos des sources avant de les servir
// (une photo de pilote MotoGP pèse 4 Mo pour 1920 × 2883 pixels ; 40 Ko suffisent pour un avatar).
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }; // gris, RVB, palette, gris + alpha, RVBA
const MAX_PIXELS = 25_000_000;

export const isPng = (buf) => buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE);

/** Dimensions d'un PNG sans le décoder. */
export const pngSize = (buf) => (isPng(buf) ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null);

/** Décode un PNG 8 bits non entrelacé en RVBA : { width, height, data }. Lève une erreur sinon. */
export function decodePng(buf) {
  if (!isPng(buf)) throw new Error('pas un PNG');
  let pos = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = CHANNELS[header?.color];
  if (!header || header.depth !== 8 || header.interlace !== 0 || !channels || (header.color === 3 && !palette)) throw new Error('PNG non pris en charge');
  const { width, height, color } = header;
  if (width * height > MAX_PIXELS) throw new Error('image trop grande');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG tronqué');
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      let v = raw[start + 1 + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const c = i >= channels ? prev[i - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v;
    }
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      if (color === 6) { out[o] = line[x * 4]; out[o + 1] = line[x * 4 + 1]; out[o + 2] = line[x * 4 + 2]; out[o + 3] = line[x * 4 + 3]; } else if (color === 2) {
        out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255;
      } else if (color === 3) {
        const k = line[x];
        out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2];
        out[o + 3] = transparency && k < transparency.length ? transparency[k] : 255;
      } else {
        const g = line[x * channels];
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = color === 4 ? line[x * 2 + 1] : 255;
      }
    }
    [prev, line] = [line, prev];
  }
  return { width, height, data: out };
}

/** Le rectangle `crop` de l'image, réduit à w × h (moyenne des pixels, pondérée par leur opacité). */
export function resize(img, w, h, crop = { x: 0, y: 0, width: img.width, height: img.height }) {
  const out = Buffer.alloc(w * h * 4);
  const src = img.data;
  for (let oy = 0; oy < h; oy++) {
    const y0 = crop.y + Math.floor((oy * crop.height) / h);
    const y1 = Math.max(y0 + 1, crop.y + Math.floor(((oy + 1) * crop.height) / h));
    for (let ox = 0; ox < w; ox++) {
      const x0 = crop.x + Math.floor((ox * crop.width) / w);
      const x1 = Math.max(x0 + 1, crop.x + Math.floor(((ox + 1) * crop.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0, i = (sy * img.width + x0) * 4; sx < x1; sx++, i += 4) {
          const alpha = src[i + 3];
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (oy * w + ox) * 4;
      if (a) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width: w, height: h, data: out };
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed));
  return Buffer.concat([head, typed, crc]);
}

/** Écrit une image RVBA en PNG (filtre « Sub » sur chaque ligne, bien adapté aux photos). */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    raw[start] = 1;
    for (let i = 0; i < stride; i++) raw[start + 1 + i] = data[y * stride + i] - (i >= 4 ? data[y * stride + i - 4] : 0);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
