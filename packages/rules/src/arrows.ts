/**
 * The off-screen arrows of 3 vs 3 and 4 vs 4. The original has one pool object 4A a base wrestler
 * (C217C4: nothing while its wrestler is on the screen, else an arrow at that edge with "1P"-"4P"
 * or "COM", scripts 20 left / 21 right, step pad or 4, in the slot's palette). The pool has no
 * room for four more, so the extras' are objects in ext WRAM, put on draw list 1 as C20038 does,
 * once a frame from the arena's own object (38, C2145A).
 *
 * They take their tiles from sprite bank 2, names 00-7F, which the extras' frames leave free: the
 * team tags of VRAM C000-CFFF, copied there at the first frame of a match, and the digits of
 * players 5-8. A human's arrow is the script's of "3P" with that digit's tiles, in WRAM. The base
 * arrows of pads 3 and 4 show the seats' numbers (numbers.ts): their digits are redrawn in VRAM.
 */
import { OBJX_BANK2, type Machine, type Runner } from '@ssm/core';
import { joined } from './players.ts';
import { playerNumber } from './seats.ts';
import { EXTRA, bigTeams, extras, rd16, teamSize, wr16 } from './slots.ts';

const ARENA_OBJECT = 0xc2145a;
/** the extras' arrow objects, 0x40 bytes each, and their poses (ext WRAM, free in a match) */
export const ARROWS = 0x6200;
const OBJECT_BYTES = 0x40;
const POSES = 0x6340;
const POSE_BYTES = 0x20;
/** byte: bank 2 has the tags of this match's team size (0: not yet) */
export const TAGS_READY = 0x63f0;
const TAG_BYTES = 0x1000;

const SCRIPTS = 0xc30000;
const LEFT = 0x20;
const RIGHT = 0x21;
const STEP_3P = 2;
const STEP_COM = 4;
/** the tiles of "3P" / "4P": digit (8 x 16: the name and the one 10 further) */
const TILE_3 = 0x62;
const TILE_4 = 0x63;
/** the extras' digits in bank 2 (free names): 40 + e */
const DIGITS_AT = 0x40;

const DRAW_COUNT = 0xf6;
const DRAW_PAGES = 0x0700;
const DRAW_DEPTHS = 0x0640;
const DRAW_MAX = 0x40;

/** the digits' strokes, 4 x 12, from column 2 and row 2 of the 8 x 16 tile */
const STROKES: Record<number, string[]> = {
  3: ['.##.', '#..#', '...#', '...#', '.##.', '...#', '...#', '...#', '...#', '...#', '#..#', '.##.'],
  4: ['...#', '..##', '..##', '.#.#', '.#.#', '#..#', '#..#', '####', '...#', '...#', '...#', '...#'],
  5: ['####', '#...', '#...', '#...', '###.', '...#', '...#', '...#', '...#', '...#', '#..#', '.##.'],
  6: ['.##.', '#..#', '#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  7: ['####', '...#', '...#', '...#', '..#.', '..#.', '..#.', '..#.', '.#..', '.#..', '.#..', '.#..'],
  8: ['.##.', '#..#', '#..#', '#..#', '#..#', '.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
};
const CORE = 4;
const EDGE = 1;
const SHADOW = 15;

/** Digit `n` in the arrows' style (core, edge around it, shadow below right) at the name's tiles. */
function drawDigit(mem: Uint8Array, base: number, name: number, n: number): void {
  const rows = STROKES[n]!;
  const core = (x: number, y: number) => rows[y - 2]?.[x - 2] === '#';
  const edge = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (core(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = 0; y < 16; y++) {
    const t = base + 32 * (name + (y >> 3) * 16) + 2 * (y & 7);
    const planes = [0, 0, 0, 0];
    for (let x = 0; x < 8; x++) {
      const v = core(x, y) ? CORE : edge(x, y) ? EDGE : edge(x - 1, y - 1) || edge(x, y - 1) ? SHADOW : 0;
      for (let p = 0; p < 4; p++) planes[p]! |= ((v >> p) & 1) << (7 - x);
    }
    [0, 1, 16, 17].forEach((o, p) => (mem[t + o] = planes[p]!));
  }
}

/** The pose (24-bit pointer) of a script's step: C200B8, as C2010F resolves it. */
function pose(c: Machine, script: number, step: number): number {
  const u16 = (a: number) => c.rom.u8(a) | (c.rom.u8(a + 1) << 8);
  const at = SCRIPTS + u16(SCRIPTS + 2 * script) + 2 * step;
  const frame = ((c.rom.u8(at) & 1) << 8) | c.rom.u8(at + 1);
  return 0xd10000 + ((u16(0xd17000 + 2 * frame) + 0x7000) & 0x1ffff);
}

/** Once a match: the tags in bank 2, the players' digits. */
function loadTags(c: Machine): void {
  const size = teamSize(c);
  const obj = (c.ioreg[0x01]! & 7) << 14;
  c.objx.set(c.vram.subarray(obj, obj + TAG_BYTES), OBJX_BANK2);
  for (let e = 0; e < extras(c); e++) drawDigit(c.objx, OBJX_BANK2, DIGITS_AT + e, playerNumber(size, 4 + e));
  drawDigit(c.vram, obj, TILE_3, playerNumber(size, 2));
  drawDigit(c.vram, obj, TILE_4, playerNumber(size, 3));
  c.wram[TAGS_READY] = size;
}

/** Extra e's arrow, if its wrestler is in the match and off the screen. */
function arrow(c: Machine, e: number): void {
  const w = c.wram;
  const page = EXTRA[e]!;
  const d = ARROWS + OBJECT_BYTES * e;
  w[d] = 0;
  if (w[page + 0x76] === 0) return;
  const x = ((rd16(c, page + 0x13) - rd16(c, 0x1a84)) << 16) >> 16;
  if (x >= -c.wide && x < 0x100 + c.wide) return;
  const n = w[DRAW_COUNT]!;
  if (n >= DRAW_MAX) return;
  const left = x < 0;
  w.fill(0, d, d + OBJECT_BYTES);
  w[d] = 1;
  w[d + 0x01] = 0x4a;
  w[d + 0x06] = 0x30 | (2 * e);
  wr16(c, d + 0x07, (left ? 0x20 - c.wide : 0xe0 + c.wide) & 0xffff);
  wr16(c, d + 0x09, (rd16(c, page + 0x1b) - 0x69 - rd16(c, 0x1a87)) & 0xffff);
  let at = pose(c, left ? LEFT : RIGHT, joined(c, e) ? STEP_3P : STEP_COM);
  if (joined(c, e)) {
    // a count, then four bytes a piece, the tile last
    const copy = POSES + POSE_BYTES * e;
    const pieces = c.rom.u8(at);
    w[copy] = pieces;
    for (let i = 1; i <= 4 * pieces; i++) {
      const v = c.rom.u8(at + i);
      w[copy + i] = i & 3 ? v : v === TILE_3 ? DIGITS_AT + e : v === TILE_3 + 0x10 ? DIGITS_AT + e + 0x10 : v;
    }
    at = 0x7e0000 | copy;
  }
  wr16(c, d + 0x0c, at & 0xffff);
  w[d + 0x0e] = at >> 16;
  w[DRAW_PAGES + n] = d & 0xff;
  w[DRAW_PAGES + n + 1] = d >> 8;
  w[DRAW_DEPTHS + n] = w[DRAW_DEPTHS + n + 1] = 0;
  w[DRAW_COUNT] = n + 2;
}

/** An extra's arrow object (sprites.ts: its tiles are bank 2's). */
export const isExtraArrow = (d: number) => d >= ARROWS && d < ARROWS + 4 * OBJECT_BYTES;

/** A match starts: its tags are not loaded yet. */
export function resetArrows(c: Machine): void {
  c.wram[TAGS_READY] = 0;
}

export function installArrows(r: Runner): void {
  r.override(ARENA_OBJECT, (c) => {
    if (bigTeams(c) && c.wram[0x56]! < 0x1c) {
      c.tick(400);
      if (!c.wram[TAGS_READY]) loadTags(c);
      for (let e = 0; e < extras(c); e++) arrow(c, e);
    }
    return r.original(c, ARENA_OBJECT);
  });
}
