/** Local controls -> pad words, with the player's layouts (settings.ts). */
import { BUTTONS, getSettings, localPads, padWords } from './settings.ts';

/** The connected gamepads, in order. Browsers list them after their first button press. */
export const connectedGamepads = (): Gamepad[] => [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g);

export class Controls {
  private readonly held = new Set<string>();
  private readonly online: boolean;
  private blocked = false;
  private readonly down = (e: KeyboardEvent) => {
    if (this.blocked || !this.bound(e.code)) return;
    e.preventDefault();
    // a repeat is not a press: the key may have been pressed in a menu
    if (!e.repeat) this.held.add(e.code);
  };
  private readonly up = (e: KeyboardEvent) => void this.held.delete(e.code);
  private readonly blur = () => this.held.clear();

  constructor(online: boolean) {
    this.online = online;
  }

  attach(): void {
    addEventListener('keydown', this.down);
    addEventListener('keyup', this.up);
    addEventListener('blur', this.blur);
  }

  detach(): void {
    removeEventListener('keydown', this.down);
    removeEventListener('keyup', this.up);
    removeEventListener('blur', this.blur);
  }

  /** While a menu is open its keys are not the game's. */
  block(on: boolean): void {
    this.blocked = on;
    this.held.clear();
  }

  private bound(code: string): boolean {
    const s = getSettings();
    const layouts = this.online || !s.keyboard2 ? [s.keyboards[0]] : s.keyboards;
    return layouts.some((k) => BUTTONS.some((b) => k[b] === code));
  }

  /** How many pads the local controls hold now. */
  players(): number {
    return localPads(getSettings(), connectedGamepads().length);
  }

  /** The pad words now, as Game.step takes them: pads 1-5 (5 unused), players 5-8. */
  read(): number[] {
    if (this.blocked) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
    return padWords(getSettings(), this.held, connectedGamepads(), this.online);
  }
}
