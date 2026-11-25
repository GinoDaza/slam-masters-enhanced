/** The automatic input delay of a room. */
import { expect, it } from 'vitest';
import { autoDelay } from '../src/room.ts';

it('the input delay follows the two slowest round trips', () => {
  expect(autoDelay([])).toBe(2);
  expect(autoDelay([2, 5, -1])).toBe(2);
  expect(autoDelay([5, 40, 60])).toBe(3);
  expect(autoDelay([80, 90])).toBe(4);
  expect(autoDelay([900, 900])).toBe(4);
});
