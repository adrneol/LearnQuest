import { describe, expect, it } from 'vitest';
import { angleDelta, dockFromPointer, pointerAngle, radialPosition, readDock, snappedIndex } from '../src/components/navigation/geometry';

describe('clock navigation geometry', () => {
  it('places noon above the center and follows clockwise order', () => {
    expect(radialPosition(0, 4, 35)).toEqual({ x: 50, y: 15 });
    expect(radialPosition(1, 4, 35).x).toBeCloseTo(85);
    expect(radialPosition(2, 4, 35).y).toBeCloseTo(85);
    expect(radialPosition(3, 4, 35).x).toBeCloseTo(15);
  });

  it('crosses the angle seam without reversing and snaps across both ends', () => {
    const center = { x: 0, y: 0 };
    expect(angleDelta(pointerAngle({ x: -1, y: .01 }, center), pointerAngle({ x: -1, y: -.01 }, center))).toBeCloseTo(.02);
    expect(snappedIndex(2, 2 * Math.PI / 3, 3)).toBe(0);
    expect(snappedIndex(0, -Math.PI / 3, 6)).toBe(5);
    expect(snappedIndex(1, Math.PI / 12, 6)).toBe(1);
  });

  it('normalizes dock travel, clamps offscreen drops and snaps to either edge', () => {
    const bounds = { left: 10, top: 100, width: 300, height: 240 };
    expect(dockFromPointer({ x: 290, y: 220 }, bounds, 44)).toEqual({ edge: 'right', fraction: .5 });
    expect(dockFromPointer({ x: -100, y: 25 }, bounds, 44)).toEqual({ edge: 'left', fraction: 0 });
    expect(dockFromPointer({ x: 500, y: 800 }, bounds, 44)).toEqual({ edge: 'right', fraction: 1 });
  });

  it('restores a stored preference and tolerates corrupt or blocked storage', () => {
    expect(readDock(() => '{"edge":"right","fraction":0.25}')).toEqual({ edge: 'right', fraction: .25 });
    expect(readDock(() => '{"edge":"right","fraction":8}')).toEqual({ edge: 'right', fraction: 1 });
    expect(readDock(() => 'invalid').edge).toBe('left');
    expect(readDock(() => { throw new Error('blocked'); }).edge).toBe('left');
  });
});
