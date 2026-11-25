# Known issues

Bugs that are understood but not fixed yet, with their cause and the planned fix.

## 3 vs 3 and 4 vs 4

- **The time-over count-up on the result screen shows the four base wrestlers' bars only**
  (C05B27 counts first members, then second). The judge adds the extras' bars, so the result is
  right; the count does not show them.
- **A third pin at the same time has no count mark**: it is counted (`referee.ts`), but the arena
  has two mark objects (66, C21F84).
- **A give-up does not show the given-up wrestler's name** (the hold queue's display, C10EAF /
  C008D6, is left out of the ported referee).
- **No off-screen arrows for the extras**: the arena creates one arrow object (4A) per base
  wrestler.
