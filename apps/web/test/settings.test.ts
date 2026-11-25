/** The settings: what is stored, rebinding, and the pad words they give. */
import { describe, expect, it } from 'vitest';
import { PAD } from '@ssm/core';
import { DEFAULT_BUTTONS, bindButton, bindKey, defaults, localPads, padWords, parseSettings } from '../src/settings.ts';

const pad = (pressed: number[], axes: number[] = [0, 0]) => ({
  id: 'pad',
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: 0 })),
});

describe('settings', () => {
  it('come back as stored; wrong or missing values are the defaults', () => {
    const s = { ...bindKey(defaults(), 0, 'Y', 'KeyJ'), volume: 35, keyboard2: true };
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
    for (const bad of [null, '', '{', '[]', 'null', '7']) expect(parseSettings(bad)).toEqual(defaults());
    const t = parseSettings('{"volume":900,"scaling":"x","firstGamepad":5,"keyboards":[{"Y":3}],"gamepads":{"pad":{"B":7,"A":"q"}}}');
    expect(t).toEqual({ ...defaults(), volume: 100, gamepads: { pad: { ...DEFAULT_BUTTONS, B: 7 } } });
  });

  it('a taken key swaps, across both keyboards', () => {
    const s = bindKey(defaults(), 0, 'Y', 'Space');
    expect([s.keyboards[0].Y, s.keyboards[0].B]).toEqual(['Space', 'KeyK']);
    const t = bindKey(defaults(), 0, 'Y', 'Numpad1');
    expect([t.keyboards[0].Y, t.keyboards[1].Y]).toEqual(['Numpad1', 'KeyK']);
    const b = bindButton(defaults(), 'pad', 'Y', 0).gamepads['pad']!;
    expect([b.Y, b.B]).toEqual([0, 2]);
  });

  it('keyboards and gamepads hold their pads', () => {
    const held = new Set(['KeyK', 'Numpad2']);
    const s = { ...defaults(), keyboard2: true, firstGamepad: 2 as const };
    const gps = [pad([1]), pad([], [-1, 1])];
    expect(padWords(s, held, gps, false)).toEqual([PAD.Y, PAD.B | PAD.A, PAD.LEFT | PAD.DOWN, 0, 0, 0, 0, 0, 0]);
    // online: the first keyboard and the first gamepad play the local slot
    expect(padWords(s, held, gps, true)[0]).toBe(PAD.Y | PAD.A);
    // the fifth gamepad is player 5 (word 5), the ninth none
    const many = padWords(defaults(), new Set(), Array.from({ length: 9 }, () => pad([0])), false);
    expect(many).toEqual([PAD.B, PAD.B, PAD.B, PAD.B, 0, PAD.B, PAD.B, PAD.B, PAD.B]);
  });

  it('a gamepad keeps X, L and R for the OPTION screen, unless bound', () => {
    const read = (s: ReturnType<typeof defaults>) => padWords(s, new Set(), [pad([3, 4, 8])], false)[0];
    expect(read(defaults())).toBe(PAD.X | PAD.L);
    expect(read(bindButton(defaults(), 'pad', 'Y', 3))).toBe(PAD.Y | PAD.L);
  });

  it('counts the local pads', () => {
    expect([localPads(defaults(), 0), localPads(defaults(), 2)]).toEqual([1, 2]);
    expect(localPads({ ...defaults(), keyboard2: true }, 1)).toBe(2);
    expect(localPads({ ...defaults(), firstGamepad: 2 }, 2)).toBe(3);
  });
});
