/** The modes as the menus present them, and the room names. */
export const MODE_TEXT: Record<string, { tagline: string; points: string[] }> = {
  classic: {
    tagline: 'The 1994 game, untouched',
    points: ['Original rules and difficulty', 'Original 4:3 picture', 'Up to 4 players'],
  },
  'team-arena': {
    tagline: 'Everything the ring can hold',
    points: ['1 VS 1 to 4 VS 4, up to 8 players', 'Out of the ring, with ringside items', 'Wide 16:9 picture'],
  },
};

const ADJECTIVES = ['STEEL', 'IRON', 'GOLDEN', 'WILD', 'THUNDER', 'MAIN', 'MIDNIGHT', 'RED'];
const NOUNS = ['CAGE', 'BELT', 'CORNER', 'ROPES', 'BELL', 'ARENA', 'SLAM'];

/** A free room name (16 characters at most). */
export function newRoomCode(taken: readonly string[]): string {
  const all = ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a} ${n}`)).filter((c) => !taken.includes(c));
  if (all.length) return all[Math.floor(Math.random() * all.length)]!;
  for (let n = 1; ; n++) if (!taken.includes(`RING ${n}`)) return `RING ${n}`;
}
