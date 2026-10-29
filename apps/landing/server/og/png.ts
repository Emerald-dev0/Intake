import { crc32, deflateSync } from 'node:zlib';

/**
 * A very small PNG writer.
 *
 * A share card has to be produced by the API without a browser binary and without a native
 * image library, so the few things a PNG needs are done here: a raster, one filter byte per
 * scanline, zlib, and the four chunks that make a file.
 *
 * Colour is 8-bit RGB. The cards are flat, so there is no palette and no alpha.
 */

export class Raster {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
  }

  /** A colour as three bytes. */
  static rgb(hex: string): [number, number, number] {
    const value = hex.replace('#', '');
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  }

  /** Paints one pixel. Out-of-bounds coordinates are ignored rather than thrown. */
  set(x: number, y: number, colour: [number, number, number]): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const offset = (py * this.width + px) * 3;
    this.pixels[offset] = colour[0];
    this.pixels[offset + 1] = colour[1];
    this.pixels[offset + 2] = colour[2];
  }

  /** Paints a filled rectangle. */
  fill(x: number, y: number, width: number, height: number, colour: [number, number, number]): void {
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const right = Math.min(this.width, Math.round(x + width));
    const bottom = Math.min(this.height, Math.round(y + height));
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) {
        this.set(px, py, colour);
      }
    }
  }

  /** A rectangle with rounded corners, filled. */
  rounded(x: number, y: number, width: number, height: number, radius: number, colour: [number, number, number]): void {
    const r = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
    const left = Math.round(x);
    const top = Math.round(y);
    const right = left + Math.round(width) - 1;
    const bottom = top + Math.round(height) - 1;
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        // The distance outside the straight part of the rectangle decides the corner.
        const dx = Math.max(left + r - px, 0, px - (right - r));
        const dy = Math.max(top + r - py, 0, py - (bottom - r));
        if (dx * dx + dy * dy <= r * r) this.set(px, py, colour);
      }
    }
  }

  /** A filled circle. */
  circle(cx: number, cy: number, radius: number, colour: [number, number, number]): void {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) this.set(cx + dx, cy + dy, colour);
      }
    }
  }

  /** The colour of one pixel, for tests. */
  pixel(x: number, y: number): [number, number, number] {
    const offset = (y * this.width + x) * 3;
    return [this.pixels[offset], this.pixels[offset + 1], this.pixels[offset + 2]];
  }

  /** The file itself. */
  toPNG(): Buffer {
    // One filter byte (0, "none") per scanline, then the row's bytes.
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0;
      Buffer.from(this.pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // colour type: truecolour
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, checksum]);
}
