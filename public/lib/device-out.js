// Turn the pixels of a canvas into the bytes that three kinds of device accept,
// and read those bytes back the way the device would.
//
//   import { deck, escpos, matrix } from '/lib/device-out.js';
//
//   deck.reports(keyIndex, jpegBytes)   -> HID output reports for one key of a Stream Deck
//   deck.pressed(dataView)              -> which keys an HID input report says are down
//   escpos.print(imageData, options)    -> ESC/POS bytes for a receipt printer (1 bit per dot)
//   matrix.frame(imageData)             -> one RGB565 frame for an LED matrix
//
// Each has a reader (deck.Reader, escpos.read, matrix.read) that parses the
// same bytes. The simulated devices on /hardware-out/ are drawn from what the
// readers return, never from the source canvas.
//
// The Stream Deck layout follows the 15-key models with JPEG keys (Original V2,
// MK.2). It has not been run against a device. ESC/POS uses the raster command
// GS v 0, which most thermal printers accept. The matrix frame is this page's
// own format, because LED matrices have no common one.

// #region deck
export const deck = {
  vendorId: 0x0fd9, // Elgato
  // Product ids of the 15-key models that take 72 x 72 JPEG key images.
  productIds: [0x006d, 0x0080, 0x00a5],
  keys: 15, columns: 5, size: 72,
  reportId: 0x02, // output report that carries a piece of a key image
  reportLength: 1024, // bytes, with the report id
  inputReportId: 0x01,

  /**
   * Split one key's JPEG into output reports. Each is the `data` argument of
   * HIDDevice.sendReport(0x02, data): 7 header bytes, then up to 1016 bytes of
   * the file, padded with zeros to 1023.
   */
  reports(key, jpeg) {
    const room = this.reportLength - 8;
    const out = [];
    for (let page = 0, at = 0; at < jpeg.length || page === 0; page++, at += room) {
      const piece = jpeg.subarray(at, at + room);
      const data = new Uint8Array(this.reportLength - 1);
      data[0] = 0x07; // command: key image
      data[1] = key;
      data[2] = at + room >= jpeg.length ? 1 : 0; // last piece
      data[3] = piece.length & 0xff; data[4] = piece.length >> 8;
      data[5] = page & 0xff; data[6] = page >> 8;
      data.set(piece, 7);
      out.push(data);
    }
    return out;
  },

  /** The `data` of the feature report (id 0x03) that sets the brightness, 0 to 100. */
  brightness(percent) {
    const data = new Uint8Array(31);
    data[0] = 0x08; data[1] = Math.max(0, Math.min(100, Math.round(percent)));
    return data;
  },

  /** Which keys are down, from the DataView of an input report with id 0x01. */
  pressed(view) {
    const down = [];
    for (let k = 0; k < this.keys; k++) if (view.getUint8(3 + k)) down.push(k);
    return down;
  },

  /** The input report a device sends when the keys in `down` are held. For the simulated device. */
  inputReport(down) {
    const data = new Uint8Array(3 + this.keys);
    data[1] = this.keys;
    for (const k of down) data[3 + k] = 1;
    return new DataView(data.buffer);
  },

  /** The key images are stored upside down: the device shows each one turned by 180 degrees. */
  turned: true,
};

/** Puts the pieces of key images back together, as the device does. Calls onkey(key, jpegBytes). */
deck.Reader = class {
  #parts = new Map();
  reports = 0;
  constructor(onkey) { this.onkey = onkey; }
  /** One output report: the same arguments as HIDDevice.sendReport(). */
  sendReport(reportId, data) {
    if (reportId !== deck.reportId || data[0] !== 0x07) throw new Error(`unexpected report ${reportId}/${data[0]}`);
    this.reports++;
    const key = data[1], last = data[2] === 1, length = data[3] | (data[4] << 8), page = data[5] | (data[6] << 8);
    const parts = page === 0 ? [] : this.#parts.get(key) ?? [];
    if (parts.length !== page) throw new Error(`key ${key}: piece ${page} arrived after ${parts.length} pieces`);
    parts.push(data.slice(7, 7 + length));
    this.#parts.set(key, parts);
    if (!last) return;
    this.#parts.delete(key);
    const jpeg = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { jpeg.set(p, at); at += p.length; }
    this.onkey?.(key, jpeg);
  }
};
// #endregion deck

// #region dither
/** Grey level 0 (black) to 255 (white) of each pixel, drawn over white paper. */
export function grey(image) {
  const { data, width, height } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    out[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
  }
  return out;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * One bit per pixel: 1 is a black dot. `how` is 'diffuse' (Floyd-Steinberg),
 * 'ordered' (a 4 x 4 Bayer pattern) or 'threshold'.
 */
export function oneBit(image, how = 'diffuse') {
  const { width, height } = image;
  const g = grey(image);
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (how === 'ordered') { bits[p] = g[p] < (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) * 16 ? 1 : 0; continue; }
      const black = g[p] < 128;
      bits[p] = black ? 1 : 0;
      if (how !== 'diffuse') continue;
      // Pass the rounding error on to the pixels that have not been decided yet.
      const err = g[p] - (black ? 0 : 255);
      if (x + 1 < width) g[p + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) g[p + width - 1] += (err * 3) / 16;
        g[p + width] += (err * 5) / 16;
        if (x + 1 < width) g[p + width + 1] += err / 16;
      }
    }
  }
  return bits;
}
// #endregion dither

// #region escpos
export const escpos = {
  /**
   * The bytes that print an image: ESC @ (reset), one GS v 0 raster command
   * per band of rows, ESC d (feed) and GS V (cut). Width is rounded up to a
   * whole number of bytes, 8 dots each, most significant bit on the left.
   */
  print(image, { dither = 'diffuse', band = 128, feed = 3, cut = true } = {}) {
    const { width, height } = image;
    const bits = oneBit(image, dither);
    const rowBytes = Math.ceil(width / 8);
    const chunks = [[0x1b, 0x40]];
    for (let y0 = 0; y0 < height; y0 += band) {
      const rows = Math.min(band, height - y0);
      const data = new Uint8Array(8 + rowBytes * rows);
      data.set([0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8]);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < width; x++) {
          if (bits[(y0 + y) * width + x]) data[8 + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
      chunks.push(data);
    }
    chunks.push([0x1b, 0x64, feed]);
    if (cut) chunks.push([0x1d, 0x56, 0x42, 0x00]);
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  },

  /**
   * Read a byte stream the way a printer would. Returns the printed rows as
   * { width, height, bits } plus the commands that were understood.
   */
  read(bytes) {
    const bands = [], commands = [];
    let width = 0, feed = 0, cut = false, i = 0;
    while (i < bytes.length) {
      const a = bytes[i], b = bytes[i + 1];
      if (a === 0x1b && b === 0x40) { commands.push('ESC @'); i += 2; }
      else if (a === 0x1d && b === 0x76 && bytes[i + 2] === 0x30) {
        const rowBytes = bytes[i + 4] | (bytes[i + 5] << 8), rows = bytes[i + 6] | (bytes[i + 7] << 8);
        bands.push({ rowBytes, rows, data: bytes.subarray(i + 8, i + 8 + rowBytes * rows) });
        width = Math.max(width, rowBytes * 8);
        commands.push(`GS v 0 ${rowBytes * 8}x${rows}`);
        i += 8 + rowBytes * rows;
      }
      else if (a === 0x1b && b === 0x64) { feed += bytes[i + 2]; commands.push(`ESC d ${bytes[i + 2]}`); i += 3; }
      else if (a === 0x1d && b === 0x56) { cut = true; commands.push('GS V'); i += bytes[i + 2] >= 0x41 ? 4 : 3; }
      else throw new Error(`byte ${i}: 0x${a.toString(16)} is not a command this reader knows`);
    }
    const height = bands.reduce((n, band) => n + band.rows, 0);
    const bits = new Uint8Array(width * height);
    let y = 0;
    for (const band of bands) {
      for (let r = 0; r < band.rows; r++, y++) {
        for (let x = 0; x < band.rowBytes * 8; x++) {
          if (band.data[r * band.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) bits[y * width + x] = 1;
        }
      }
    }
    return { width, height, bits, feed, cut, commands };
  },
};
// #endregion escpos

// #region matrix
export const matrix = {
  /**
   * One frame: the bytes "HC", the width, the height, then two bytes per pixel,
   * RGB565 with the low byte first, rows from the top.
   */
  frame(image) {
    const { data, width, height } = image;
    const out = new Uint8Array(4 + width * height * 2);
    out.set([0x48, 0x43, width, height]);
    for (let i = 0, o = 4; i < data.length; i += 4, o += 2) {
      const a = data[i + 3] / 255; // over black: an LED that is off
      const v = (((data[i] * a) >> 3) << 11) | (((data[i + 1] * a) >> 2) << 5) | ((data[i + 2] * a) >> 3);
      out[o] = v & 0xff; out[o + 1] = v >> 8;
    }
    return out;
  },

  /** Read a frame back into an ImageData. */
  read(bytes) {
    if (bytes[0] !== 0x48 || bytes[1] !== 0x43) throw new Error('not a frame: it does not start with "HC"');
    const width = bytes[2], height = bytes[3];
    const image = new ImageData(width, height);
    for (let o = 4, i = 0; i < image.data.length; o += 2, i += 4) {
      const v = bytes[o] | (bytes[o + 1] << 8);
      const r = v >> 11, g = (v >> 5) & 63, b = v & 31;
      image.data[i] = (r << 3) | (r >> 2); image.data[i + 1] = (g << 2) | (g >> 4); image.data[i + 2] = (b << 3) | (b >> 2); image.data[i + 3] = 255;
    }
    return image;
  },
};
// #endregion matrix
