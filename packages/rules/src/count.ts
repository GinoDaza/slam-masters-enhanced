/**
 * The time-over count of 3 vs 3 and 4 vs 4. The original's task C059B6 counts the bars up on the
 * screen: C05A0F copies each shown life to +1DC, then C05B27 takes a unit a frame from the
 * first member of each team (pages at `$66` / `$6A`) into the totals `$1A6B` / `$1A6D`, then
 * from the second ones (`$68` / `$6C`), and the judge compares the totals (C10D3B, referee.ts).
 * Here the extras follow: the second loop runs again with a pair of theirs (from C059DE, its
 * pause and sound) until none is left. The bars (C05B78) have room for two members, three bands
 * of ten tiles, so a total of three or four is drawn in proportion.
 */
import type { Machine, Runner } from '@ssm/core';
import { EXTRA, bigTeams, extras, rd16, sideOf, teamSize, wr16 } from './slots.ts';

const START = 0xc05a0f;
const SECOND_DONE = 0xc059fd;
const SECOND_LOOP = 0xc059de;
const DRAW_TOTAL = 0xc05b78;
const LIFE_BARS = 0xc09793;
const LEFT = 0x1dc;

/** The extras of 0800's team (or the other), in order. */
function team(c: Machine, first: boolean): number[] {
  const side = sideOf(c, 0x0800);
  return EXTRA.slice(0, extras(c)).filter((p) => (sideOf(c, p) === side) === first);
}

export function installCount(r: Runner): void {
  r.override(START, (c) => {
    if (bigTeams(c)) for (const p of EXTRA.slice(0, extras(c))) c.wram[p + LEFT] = c.rom.u8(LIFE_BARS + c.wram[p + 0x79]!);
    return r.original(c, START);
  });
  // C059FD SEP #$20: the pair at `$68` / `$6C` is counted
  r.override(SECOND_DONE, (c) => {
    if (bigTeams(c)) {
      const a = team(c, true);
      const k = a.indexOf(rd16(c, 0x68)) + 1; // a base page: the first pair
      if (k < a.length) {
        c.tick(60);
        wr16(c, 0x68, a[k]!);
        wr16(c, 0x6c, team(c, false)[k]!);
        c.setP(c.p | 0x20);
        return SECOND_LOOP;
      }
    }
    return r.original(c, SECOND_DONE);
  });
  // C05B78 (16-bit A = a total, Y = its bar)
  r.override(DRAW_TOTAL, (c) => {
    if (bigTeams(c)) c.setA(Math.trunc((2 * (c.a & 0xffff)) / teamSize(c)), 16);
    return r.original(c, DRAW_TOTAL);
  });
}
