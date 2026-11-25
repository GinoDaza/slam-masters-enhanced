/**
 * The players' numbers in 3 vs 3 and 4 vs 4: the original shows pad 3 as "3P", the lobby and the
 * entry number players team by team (seats.ts: pad 3 is P4 in 3 VS 3, P5 in 4 VS 4). Here the
 * rest of the game shows the seats' numbers too:
 *
 * - the strings (the VS and result screens' labels): runs of two characters "nP" drawn by
 *   C0086A (8 x 16 font, the character in A at C008B2) and C0081F (8 x 8, at C00856);
 * - the HUD's tags (C05FF6: the tile 2030 | n in A at C06043);
 * - the player select's markers, sprites: pad p's own "nP" over its picture (16 x 16, name E6 + 2p)
 *   and over its partner's (188 + 2p). Their digits are redrawn in VRAM while the screen shows.
 */
import type { Machine, Runner } from '@ssm/core';
import { playerNumber } from './seats.ts';

const TEAM_FLAG = 0x1ba0;
const TEAM_BIT = 0x40;
const STRING_2 = 0xc008b2;
const STRING_1 = 0xc00856;
const HUD_TAG = 0xc06043;
const DIGIT_0 = 0x30;
const LETTER_P = 0x50;

/** The number shown for pad number `n` (1-4) in a match of `size` a team. */
const shown = (c: Machine, n: number, size: number) =>
  size > 2 && (c.wram[TEAM_FLAG]! & TEAM_BIT) !== 0 && n >= 1 && n <= 4 ? playerNumber(size, n - 1) : n;

/** the digits pads 3 and 4 may show (4-6), four pixels by seven */
const DIGITS: Record<number, string[]> = {
  4: ['.##.', '###.', '#.#.', '#.#.', '####', '..#.', '..#.'],
  5: ['####', '#...', '###.', '...#', '...#', '#..#', '.##.'],
  6: ['.##.', '#...', '###.', '#..#', '#..#', '#..#', '.##.'],
};
/** the digit's place in the marker's first tile: columns 4-7 of rows 0-7; column 8 is the P's */
const DIGIT_X = 4;
const MARKS = [0xe6, 0x188] as const;
/** the marker's colours: pad p's 2 + p, the outline */
const COLOUR = 2;
const OUTLINE = 15;
/** the sprite tiles' VRAM: names 100-1FF follow 000-0FF (OBSEL's gap 0) */
const spriteTile = (c: Machine, name: number) => ((((c.ioreg[0x01]! & 7) << 14) + 32 * name) & 0xffff);

/** The player select's markers of pads 3 and 4 (pads 1 and 2 keep their numbers), size > 2. */
export function markNumbers(c: Machine, size: number): void {
  for (let pad = 0; pad < 4; pad++) {
    const n = shown(c, pad + 1, size);
    const digit = DIGITS[n];
    if (n === pad + 1 || !digit) continue;
    for (const name of MARKS) {
      const t = spriteTile(c, name + 2 * pad);
      // the marker's tiles are there: the frame's corner line stays, the digit has its colour
      for (let y = 0; y < 8; y++)
        for (let k = 0; k < 4; k++) {
          const on = digit[y]?.[k] === '#';
          const v = on ? COLOUR + pad : OUTLINE;
          const bit = 0x80 >> (DIGIT_X + k);
          for (let p = 0; p < 4; p++) {
            const a = (t + 2 * y + (p & 1) + (p >> 1) * 16) & 0xffff;
            if ((v >> p) & 1) c.vram[a]! |= bit;
            else c.vram[a]! &= ~bit;
          }
        }
    }
  }
}

export function installNumbers(r: Runner, size: (c: Machine) => number): void {
  // C008B2 TAX / C00856 STA $0500,X (8-bit A = the character, Y = its place in the string `$00`,
  // `$21` = the characters left of the run)
  for (const pc of [STRING_2, STRING_1]) {
    r.override(pc, (c) => {
      const ch = c.a & 0xff;
      if (ch > DIGIT_0 && ch <= DIGIT_0 + 4 && c.wram[0x21] === 2) {
        const at = c.wram[0x00]! | (c.wram[0x01]! << 8);
        if (c.peek8((c.db << 16) | ((at + (c.y & 0xff) + 1) & 0xffff)) === LETTER_P) c.setA(DIGIT_0 + shown(c, ch - DIGIT_0, size(c)), 8);
      }
      return r.original(c, pc);
    });
  }
  // C06043 STA $1D5E,X (16-bit A = the tag's digit tile)
  r.override(HUD_TAG, (c) => {
    const n = (c.a & 0xff) - DIGIT_0;
    c.setA((c.a & 0xff00) | (DIGIT_0 + shown(c, n, size(c))), 16);
    return r.original(c, HUD_TAG);
  });
}
