/**
 * The menus without a mouse: the gamepad's D-pad / left stick and the arrow keys move the focus
 * to the nearest control that way, button A (bottom) presses it, B (right) is Esc. In the game
 * (no menu over it) the gamepad's SELECT opens the menu: the game itself has no use for it.
 */
import { connectedGamepads } from './input.ts';
import { BUTTONS, buttonsOf, getSettings } from './settings.ts';

type Dir = 'up' | 'down' | 'left' | 'right';

/** first repeat of a held direction, then each next, ms */
const REPEAT_FIRST = 400;
const REPEAT = 120;
const PRESS = 0;
const BACK = 1;
const SELECT = 8;

let held = false;

/** The settings read the gamepad themselves while they wait for a button. */
export function holdNav(on: boolean): void {
  held = on;
}

/** The menu on top: the one over the game, or the whole page; null when the game has the controls. */
function scope(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.overlay') ?? (document.querySelector('.game') ? null : document.body);
}

function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, select')].filter((e) => !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0);
}

function move(dir: Dir): void {
  const root = scope();
  if (!root) return;
  const all = controls(root);
  const from = document.activeElement as HTMLElement | null;
  if (!from || !all.includes(from)) {
    (root.querySelector<HTMLElement>('[data-first]') ?? all[0])?.focus();
    return;
  }
  const a = from.getBoundingClientRect();
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const e of all) {
    if (e === from) continue;
    const b = e.getBoundingClientRect();
    const dx = (b.left + b.right - a.left - a.right) / 2;
    const dy = (b.top + b.bottom - a.top - a.bottom) / 2;
    const along = sign * (horizontal ? dx : dy);
    // how far apart across the move: 0 when they overlap
    const gap = horizontal ? Math.max(b.top - a.bottom, a.top - b.bottom, 0) : Math.max(b.left - a.right, a.left - b.right, 0);
    if (along < 4) continue;
    const s = along + 3 * gap + 0.1 * Math.abs(horizontal ? dy : dx);
    if (s < score) {
      score = s;
      best = e;
    }
  }
  best?.focus();
  best?.scrollIntoView({ block: 'nearest' });
}

/** Set a control as the user would, so React sees it. */
function setValue(e: HTMLSelectElement | HTMLInputElement, value: string): void {
  const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, value);
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

/** Left / right on a list or a slider change it. */
function adjust(dir: Dir): boolean {
  const e = document.activeElement;
  const step = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  if (!step) return false;
  if (e instanceof HTMLSelectElement) {
    const k = e.selectedIndex + step;
    if (k >= 0 && k < e.options.length) setValue(e, e.options[k]!.value);
    return true;
  }
  if (e instanceof HTMLInputElement && e.type === 'range') {
    setValue(e, String(Math.min(Number(e.max), Math.max(Number(e.min), Number(e.value) + 5 * step))));
    return true;
  }
  return false;
}

const escape = () => dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));

const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Start; returns the function that stops it. */
export function startNav(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const dir = ARROWS[e.code];
    if (!dir || held || !scope()) return;
    const at = document.activeElement;
    // these use the arrows themselves
    if (at instanceof HTMLSelectElement || (at instanceof HTMLInputElement && at.type !== 'checkbox')) {
      const free = at instanceof HTMLInputElement && (dir === 'up' || dir === 'down');
      if (!free) return;
    }
    e.preventDefault();
    move(dir);
  };
  addEventListener('keydown', onKey);

  let raf = 0;
  let before = new Set<string>();
  let dirNow: Dir | null = null;
  let nextAt = 0;
  const poll = (now: number) => {
    raf = requestAnimationFrame(poll);
    const pressed = new Set<string>();
    let dir: Dir | null = null;
    const gps = connectedGamepads();
    gps.forEach((gp) => {
      gp.buttons.forEach((b, i) => b.pressed && pressed.add(`${gp.index}:${i}`));
      const [x = 0, y = 0] = gp.axes;
      if (gp.buttons[12]?.pressed || y < -0.6) dir = 'up';
      else if (gp.buttons[13]?.pressed || y > 0.6) dir = 'down';
      else if (gp.buttons[14]?.pressed || x < -0.6) dir = 'left';
      else if (gp.buttons[15]?.pressed || x > 0.6) dir = 'right';
    });
    const was = before;
    const fresh = (gp: Gamepad, i: number) => pressed.has(`${gp.index}:${i}`) && !was.has(`${gp.index}:${i}`);
    before = pressed;
    const turned = dir !== dirNow;
    if (turned) {
      dirNow = dir;
      nextAt = now + REPEAT_FIRST;
    }
    if (held || !document.hasFocus()) return;
    const menu = scope();
    if (!menu) {
      for (const gp of gps) {
        const map = buttonsOf(getSettings(), gp.id);
        if (fresh(gp, SELECT) && !BUTTONS.some((b) => map[b] === SELECT)) return void escape();
      }
      return;
    }
    if (dir && (turned || now >= nextAt)) {
      if (!turned) nextAt = now + REPEAT;
      if (!adjust(dir)) move(dir);
    }
    for (const gp of gps) {
      if (fresh(gp, PRESS)) {
        const at = document.activeElement as HTMLElement | null;
        if (at && controls(menu).includes(at)) {
          if (at instanceof HTMLSelectElement) adjustNext(at);
          else at.click();
        } else move('down');
        return;
      }
      if (fresh(gp, BACK) || fresh(gp, SELECT)) return void escape();
    }
  };
  raf = requestAnimationFrame(poll);
  return () => {
    removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf);
  };
}

/** A press on a list takes its next option, around. */
function adjustNext(e: HTMLSelectElement): void {
  setValue(e, e.options[(e.selectedIndex + 1) % e.options.length]!.value);
}
