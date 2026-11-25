import type { Ruleset } from './ruleset.ts';
import { classicRules } from './classic.ts';

/**
 * 2 vs 2 in the singles arena: out of the ring, on the floor, with the ringside items; singles
 * and team matches in the wide, full-height picture;
 * two levels harder by default.
 */
export const teamArenaRules: Ruleset = { ...classicRules, id: 'team-arena', label: 'Enhanced', singlesArena: true, screenWidth: 400, fullHeight: true, wideSingles: true, modeMenu: true, wideMenus: true, difficulty: 5, multitap: 'always' };

/** The modes a room can pick (the game's own menus still choose singles or team). */
export const PLAYABLE_RULES: readonly Ruleset[] = [classicRules, teamArenaRules];

export function rulesById(id: string): Ruleset {
  return PLAYABLE_RULES.find((r) => r.id === id) ?? classicRules;
}
