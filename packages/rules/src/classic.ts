import type { Ruleset } from './ruleset.ts';

/** The original game: no overrides at all. */
export const classicRules: Ruleset = {
  id: 'classic',
  label: 'Original',
  singlesArena: false,
  screenWidth: 256,
  fullHeight: false,
  wideSingles: false,
  modeMenu: false,
  wideMenus: false,
  difficulty: 3,
  multitap: 'players',
};
