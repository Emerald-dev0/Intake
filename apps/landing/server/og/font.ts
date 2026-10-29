/**
 * A 5×7 bitmap font.
 *
 * The share card has to be drawn by the API without a browser binary and without a native image
 * library, so the type is a bitmap: each glyph is five columns of seven pixels, and a column is
 * a byte whose lowest bit is the top row.
 *
 * It is a plain, sturdy face — the kind of lettering on a receipt or a departure board — and it
 * is used at two sizes only, so it never has to look like anything else.
 */

/** The glyphs, in the order of printable ASCII from space to tilde. */
const GLYPHS: string[] = [
  '0000000000', // space
  '00005f0000', // !
  '0007000700', // "
  '147f147f14', // #
  '242a7f2a12', // $
  '2313086462', // %
  '3649552250', // &
  '0005030000', // '
  '001c224100', // (
  '0041221c00', // )
  '14083e0814', // *
  '08083e0808', // +
  '0050300000', // ,
  '0808080808', // -
  '0060600000', // .
  '2010080402', // /
  '3e5149453e', // 0
  '00427f4000', // 1
  '4261514946', // 2
  '2141454b31', // 3
  '1814127f10', // 4
  '2745454539', // 5
  '3c4a494930', // 6
  '0171090503', // 7
  '3649494936', // 8
  '064949291e', // 9
  '0036360000', // :
  '0056360000', // ;
  '0008142241', // <
  '1414141414', // =
  '4122140800', // >
  '0201510906', // ?
  '324979413e', // @
  '7e1111117e', // A
  '7f49494936', // B
  '3e41414122', // C
  '7f4141221c', // D
  '7f49494941', // E
  '7f09090101', // F
  '3e41415132', // G
  '7f0808087f', // H
  '00417f4100', // I
  '2040413f01', // J
  '7f08142241', // K
  '7f40404040', // L
  '7f0204027f', // M
  '7f0408107f', // N
  '3e4141413e', // O
  '7f09090906', // P
  '3e4151215e', // Q
  '7f09192946', // R
  '4649494931', // S
  '01017f0101', // T
  '3f4040403f', // U
  '1f2040201f', // V
  '7f2018207f', // W
  '6314081463', // X
  '0304780403', // Y
  '6151494543', // Z
  '00007f4141', // [
  '0204081020', // backslash
  '41417f0000', // ]
  '0402010204', // ^
  '4040404040', // _
  '0001020400', // `
  '2054545478', // a
  '7f48444438', // b
  '3844444420', // c
  '384444487f', // d
  '3854545418', // e
  '087e090102', // f
  '0c5252523e', // g
  '7f08040478', // h
  '00447d4000', // i
  '2040443d00', // j
  '7f10284400', // k
  '00417f4000', // l
  '7c04180478', // m
  '7c08040478', // n
  '3844444438', // o
  '7c14141408', // p
  '081414187c', // q
  '7c08040408', // r
  '4854545420', // s
  '043f444020', // t
  '3c4040207c', // u
  '1c2040201c', // v
  '3c4030403c', // w
  '4428102844', // x
  '0c5050503c', // y
  '4464544c44', // z
  '0008364100', // {
  '00007f0000', // |
  '0041360800', // }
  '08082a1c08', // ~
];

/** Every glyph, as five columns of seven pixels. */
const FONT: number[][] = GLYPHS.map(hex => {
  const columns: number[] = [];
  for (let index = 0; index < 10; index += 2) {
    columns.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return columns;
});

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

/** The columns of one character, or null when it has no glyph. */
export function glyph(character: string): number[] | null {
  const code = character.charCodeAt(0);
  if (code < 32 || code > 126) return null;
  return FONT[code - 32];
}

/** How wide a string is, in pixels, at a given scale and letter spacing. */
export function measure(text: string, scale: number, spacing = 1): number {
  if (!text) return 0;
  return text.length * (GLYPH_WIDTH * scale + spacing * scale) - spacing * scale;
}

/**
 * Draws text.
 *
 * `bold` paints the glyph twice, one pixel to the right, which is what a heavier weight looks
 * like at this size — and it keeps the card's headline from disappearing into the background.
 */
export function drawText(
  target: { set(x: number, y: number, colour: [number, number, number]): void },
  text: string,
  x: number,
  y: number,
  scale: number,
  colour: [number, number, number],
  options: { spacing?: number; bold?: boolean } = {},
): number {
  const spacing = options.spacing ?? 1;
  const step = (GLYPH_WIDTH + spacing) * scale;
  let cursor = x;
  for (const character of text) {
    const columns = glyph(character);
    if (columns) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        const bits = columns[column];
        for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
          if (!(bits & (1 << row))) continue;
          // One font pixel becomes a scale × scale block of real pixels.
          const left = cursor + column * scale;
          const top = y + row * scale;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              target.set(left + dx, top + dy, colour);
              if (options.bold) target.set(left + dx + scale, top + dy, colour);
            }
          }
        }
      }
    }
    cursor += step;
  }
  return cursor - x;
}

/**
 * Breaks text into lines that fit a width.
 *
 * Words are kept whole where they can be, and a word too long for the line is broken rather than
 * allowed to run off the card.
 */
export function wrap(text: string, maxWidth: number, scale: number, spacing = 1): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, scale, spacing) <= maxWidth || !line) {
        // A single word longer than the line is broken by character.
        if (measure(candidate, scale, spacing) > maxWidth && !line) {
          let piece = '';
          for (const character of word) {
            if (measure(piece + character, scale, spacing) > maxWidth) {
              lines.push(piece);
              piece = character;
            } else {
              piece += character;
            }
          }
          line = piece;
          continue;
        }
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}
