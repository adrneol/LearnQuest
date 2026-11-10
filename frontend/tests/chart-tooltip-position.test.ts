import { expect, it } from 'vitest';
import { tooltipPosition } from '../src/components/charts/tooltipPosition';

const viewport = { left: 0, top: 0, right: 320, bottom: 640 };

it('places adjacent to either horizontal edge without covering the mark', () => {
  expect(tooltipPosition({ x: 22, y: 100 }, 160, 50, viewport, [])).toEqual({ x: 34, y: 75 });
  expect(tooltipPosition({ x: 298, y: 100 }, 160, 50, viewport, [])).toEqual({ x: 126, y: 75 });
});

it('flips vertically for wide tooltips near the upper or lower edge', () => {
  expect(tooltipPosition({ x: 160, y: 12 }, 250, 65, viewport, [])).toEqual({ x: 35, y: 24 });
  expect(tooltipPosition({ x: 160, y: 625 }, 250, 65, viewport, [])).toEqual({ x: 35, y: 548 });
});

it('avoids expanded navigation and suppresses a tooltip when the mark is covered', () => {
  const dock = { left: 0, top: 112, right: 190, bottom: 190 };
  expect(tooltipPosition({ x: 225, y: 120 }, 100, 48, viewport, [dock])).toEqual({ x: 175, y: 60 });
  expect(tooltipPosition({ x: 120, y: 130 }, 100, 48, viewport, [dock])).toBeUndefined();
});

it('prefers the placement with the least plot coverage when requested', () => {
  const plot = { left: 20, top: 60, right: 300, bottom: 270 };
  expect(tooltipPosition({ x: 90, y: 260 }, 130, 55, viewport, [], plot)).toEqual({ x: 25, y: 272 });
});
