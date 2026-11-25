/**
 * The player's settings (controls, sound, picture), kept in this browser. They only touch the
 * client: the game and the other peers see pad words, so none of this is in a Ruleset.
 */
import { PAD } from '@ssm/core';

/**
 * The buttons the game uses, in the order the settings list them. X, L and R only do something
 * if the game's OPTION screen assigns an action to them; SELECT never does.
 */
export const BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'Y', 'B', 'A', 'START'] as const;
export type Button = (typeof BUTTONS)[number];

/** SNES button -> KeyboardEvent.code ('' is none). */
export type Keys = Record<Button, string>;
/** SNES button -> gamepad button index (-1 is none). The left stick always moves too. */
export type Buttons = Record<Button, number>;

export interface Settings {
  /** 0-100 */
  volume: number;
  muted: boolean;
  /** fill: as large as the window allows; integer: whole multiples of the picture only */
  scaling: 'fill' | 'integer';
  scanlines: boolean;
  /** keyboard layouts of pads 1 and 2 */
  keyboards: [Keys, Keys];
  /** local play: the second layout plays pad 2 */
  keyboard2: boolean;
  /** local play: the pad of the first gamepad (1 shares it with the keyboard) */
  firstGamepad: 1 | 2;
  /** layouts by Gamepad.id; the others use DEFAULT_BUTTONS */
  gamepads: Record<string, Buttons>;
}

/** By position (W3C standard mapping): bottom B, right A, left Y. */
export const DEFAULT_BUTTONS: Buttons = { B: 0, A: 1, Y: 2, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** Gamepad buttons left to the game's OPTION assignment, unless bound to something else. */
const SPARE: [index: number, bit: number][] = [[3, PAD.X], [4, PAD.L], [5, PAD.R]];

/** The defaults, a new copy each time. */
export function defaults(): Settings {
  return {
    volume: 100,
    muted: false,
    scaling: 'fill',
    scanlines: false,
    keyboards: [
      { UP: 'KeyW', DOWN: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD', Y: 'KeyK', B: 'Space', A: 'KeyE', START: 'Enter' },
      { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', Y: 'Numpad1', B: 'Numpad2', A: 'Numpad3', START: 'NumpadEnter' },
    ],
    keyboard2: false,
    firstGamepad: 1,
    gamepads: {},
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `base` with the values of `saved` that have the right type. */
function layout<T extends string | number>(base: Record<Button, T>, saved: unknown): Record<Button, T> {
  const out = { ...base };
  if (isRecord(saved)) for (const b of BUTTONS) if (typeof saved[b] === typeof base[b]) out[b] = saved[b] as T;
  return out;
}

/** Settings from what was stored: anything missing or wrong falls back to its default. */
export function parseSettings(json: string | null): Settings {
  const s = defaults();
  let v: unknown;
  try {
    v = JSON.parse(json ?? '');
  } catch {
    return s;
  }
  if (!isRecord(v)) return s;
  if (typeof v.volume === 'number' && Number.isFinite(v.volume)) s.volume = Math.min(100, Math.max(0, v.volume));
  if (typeof v.muted === 'boolean') s.muted = v.muted;
  if (v.scaling === 'fill' || v.scaling === 'integer') s.scaling = v.scaling;
  if (typeof v.scanlines === 'boolean') s.scanlines = v.scanlines;
  if (Array.isArray(v.keyboards)) s.keyboards = [layout(s.keyboards[0], v.keyboards[0]), layout(s.keyboards[1], v.keyboards[1])];
  if (typeof v.keyboard2 === 'boolean') s.keyboard2 = v.keyboard2;
  if (v.firstGamepad === 1 || v.firstGamepad === 2) s.firstGamepad = v.firstGamepad;
  if (isRecord(v.gamepads)) for (const [id, b] of Object.entries(v.gamepads)) s.gamepads[id] = layout(DEFAULT_BUTTONS, b);
  return s;
}

/** Bind a key; whichever button of either keyboard had it takes the old key instead. */
export function bindKey(s: Settings, keyboard: 0 | 1, button: Button, code: string): Settings {
  const keyboards: [Keys, Keys] = [{ ...s.keyboards[0] }, { ...s.keyboards[1] }];
  const old = keyboards[keyboard][button];
  for (const k of keyboards) for (const b of BUTTONS) if (k[b] === code) k[b] = old;
  keyboards[keyboard][button] = code;
  return { ...s, keyboards };
}

export const buttonsOf = (s: Settings, id: string): Buttons => s.gamepads[id] ?? DEFAULT_BUTTONS;

/** Bind a gamepad's button; the SNES button that had it takes the old one instead. */
export function bindButton(s: Settings, id: string, button: Button, index: number): Settings {
  const b = { ...buttonsOf(s, id) };
  for (const k of BUTTONS) if (b[k] === index) b[k] = b[button];
  b[button] = index;
  return { ...s, gamepads: { ...s.gamepads, [id]: b } };
}

/** The pad word of the held keys. */
export function keysWord(keys: Keys, held: ReadonlySet<string>): number {
  let w = 0;
  for (const b of BUTTONS) if (held.has(keys[b])) w |= PAD[b];
  return w;
}

/** The pad word of a gamepad: its buttons and the left stick. */
export function gamepadWord(map: Buttons, gp: Pick<Gamepad, 'buttons' | 'axes'>): number {
  let w = 0;
  for (const b of BUTTONS) if (gp.buttons[map[b]]?.pressed) w |= PAD[b];
  for (const [i, bit] of SPARE) if (gp.buttons[i]?.pressed && !BUTTONS.some((b) => map[b] === i)) w |= bit;
  const [x = 0, y = 0] = gp.axes;
  if (x < -0.5) w |= PAD.LEFT;
  if (x > 0.5) w |= PAD.RIGHT;
  if (y < -0.5) w |= PAD.UP;
  if (y > 0.5) w |= PAD.DOWN;
  return w;
}

/**
 * Local pad words, as Game.step takes them: pads 1-5 (5 unused), players 5-8. Online only pad 1
 * counts: the first keyboard and the first gamepad, whatever pad it has in local play.
 */
export function padWords(s: Settings, held: ReadonlySet<string>, gamepads: readonly Pick<Gamepad, 'id' | 'buttons' | 'axes'>[], online: boolean): number[] {
  const pads = [keysWord(s.keyboards[0], held), 0, 0, 0, 0, 0, 0, 0, 0];
  if (!online && s.keyboard2) pads[1] = keysWord(s.keyboards[1], held);
  const first = online ? 0 : s.firstGamepad - 1;
  gamepads.forEach((gp, i) => {
    const pad = first + i;
    if (pad > 7) return;
    const word = pad < 4 ? pad : pad + 1;
    pads[word] = pads[word]! | gamepadWord(buttonsOf(s, gp.id), gp);
  });
  return pads;
}

/** How many pads local play holds. */
export function localPads(s: Settings, gamepads: number): number {
  return Math.max(s.keyboard2 ? 2 : 1, gamepads ? s.firstGamepad - 1 + gamepads : 0);
}

const KEY_NAMES: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', '': '—' };

/** A key as the settings show it. */
export function keyName(code: string): string {
  return KEY_NAMES[code] ?? code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ').replace(/(Left|Right)$/, ' $1');
}

/** What a button does in the game, with its default OPTION assignment. */
export const BUTTON_HELP: Record<Button, string> = {
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  Y: 'Attack (Y)',
  B: 'Jump (B)',
  A: 'Pin (A)',
  START: 'Start / pause',
};

// the store: one copy for the page, saved on every change

const KEY = 'settings';
let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  if (!current) {
    let json: string | null = null;
    try {
      json = localStorage.getItem(KEY);
    } catch {
      // storage unavailable: the defaults
    }
    current = parseSettings(json);
  }
  return current;
}

export function setSettings(s: Settings): void {
  current = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // not remembered
  }
  for (const f of listeners) f();
}

export function onSettings(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}
