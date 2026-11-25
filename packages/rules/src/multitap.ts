/**
 * The multitap in port 2 (Ruleset.multitap). The game finds it at power-on and then counts more
 * than two pads (`$7A`), which shows: PRESS / START for a challenger on pads 3-4, the team
 * entry's boxes. A session of the original plugs it only when it needs it.
 */
import type { Ruleset } from './ruleset.ts';

/**
 * Whether a session plugs the multitap, the same on every peer. `size`: wrestlers a team in the
 * lobby, 1 for a local game; `pads`: the local game's pads. A team lobby always needs it: its
 * teams are pads 1-2 against 3-4 (seats.ts).
 */
export function plugMultitap(rules: Ruleset, size: number, pads: number): boolean {
  return rules.multitap === 'always' || size > 1 || pads > 2;
}
