/**
 * ENTER THE MATCH! of a 4 VS 4 with four humans (menus.ts, players.ts): players 5-8's boxes say
 * PRESS START although no original box waits, HURRY UP! blinks as the original's, the count runs
 * on for them, and the screen ends 8 frames after the last one joins.
 */
import { expect, it } from 'vitest';
import { Game, HUDX_COLS, HUDX_ROWS, PAD, padsFromScript } from '@ssm/core';
import { installRules, teamArenaRules } from '../src/index.ts';
import { haveRom, loadRom } from '../../core/test/fixture.ts';

const MENU = 'wait*649 start*4 wait*60 start*4 wait*220 2start*4 wait*20 3start*4 wait*20 4start*4 wait*30 right*4 wait*30 right*4 wait*30 right*4 wait*30 y*4 wait*60';

it.skipIf(!haveRom())('the entry waits for players 5-8, with the original texts', () => {
  const g = new Game(loadRom());
  installRules(g, teamArenaRules);
  g.powerOn();
  g.m.multitap = true;
  for (const t of MENU.split(' ')) {
    const [s, n] = t.split('*');
    for (let k = 0; k < Number(n); k++) g.step(padsFromScript(s!));
  }
  const w = g.m.wram;
  expect([w[0x56], w[0x1ba4]]).toEqual([4, 4]);
  const step = (x: number[] = []) => g.step([0, 0, 0, 0, 0, ...x]);
  /** the palettes of a letter tile (its low 10 bits) in the panels */
  const palettes = (tile: number) => {
    const out: number[] = [];
    for (let i = 0; i < 2 * HUDX_ROWS * HUDX_COLS; i++) {
      const v = g.m.hudxMap[2 * i]! | (g.m.hudxMap[2 * i + 1]! << 8);
      if ((v & 0x3ff) === tile) out.push((v >> 10) & 7);
    }
    return out.sort();
  };
  const PRESS = 0x315;
  const HURRY = 0x325;
  expect(palettes(PRESS)).toEqual([0, 1, 2, 3]);
  expect(palettes(HURRY)).toEqual([]);
  // far past the 256 frames the original gives four humans
  while (w[0x1b92]! >= 4) step();
  const seen = new Set<string>();
  for (let f = 0; f < 32; f++) {
    step();
    seen.add(palettes(HURRY).join());
  }
  expect([...seen].sort()).toEqual(['0,1,2,3', '4,5,6,7']);
  // all in: the end
  step([PAD.START, PAD.START, PAD.START, PAD.START]);
  step();
  expect(palettes(PRESS)).toEqual([]);
  let frames = 0;
  while (w[0x56] === 4 && frames < 300) {
    step();
    frames++;
  }
  expect(frames).toBeLessThan(120);
});
