/** The Original mode is the original: nothing replaced, and the state of a game without rules. */
import { describe, expect, it } from 'vitest';
import { Game, checksum, padsFromScript } from '@ssm/core';
import { classicRules, installRules, plugMultitap, teamArenaRules } from '../src/index.ts';
import { haveRom, loadRom } from '../../core/test/fixture.ts';

describe('the Original mode', () => {
  it.skipIf(!haveRom())('installs no override and runs as a game without rules', () => {
    const bare = new Game(loadRom());
    const g = new Game(loadRom());
    installRules(g, classicRules);
    expect(g.runner.overrides.size).toBe(0);
    bare.powerOn();
    g.powerOn();
    const steps = 'wait*654 start*4 wait*60 start*4 wait*200'.split(' ');
    for (const t of steps) {
      const [s, n] = t.split('*');
      for (let k = 0; k < Number(n); k++) {
        bare.step(padsFromScript(s!));
        g.step(padsFromScript(s!));
      }
    }
    expect(checksum(g.m.save())).toBe(checksum(bare.m.save()));
  });

  it('plugs the multitap only when pads 3-4 may play', () => {
    expect(plugMultitap(classicRules, 1, 2)).toBe(false);
    expect(plugMultitap(classicRules, 1, 3)).toBe(true);
    expect(plugMultitap(classicRules, 2, 2)).toBe(true);
    expect(plugMultitap(teamArenaRules, 1, 1)).toBe(true);
  });
});
