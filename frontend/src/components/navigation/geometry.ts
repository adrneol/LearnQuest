export interface Point { x: number; y: number }
export interface DockPosition { edge: 'left' | 'right'; fraction: number }
export const DEFAULT_DOCK: DockPosition = { edge: 'left', fraction: 0.78 };
export const DOCK_KEY = 'lq-navigation-dock';
export const GESTURE_THRESHOLD = 8;
const turn = 2 * Math.PI;

export const wrapIndex = (index: number, count: number) => ((index % count) + count) % count;
export const pointerAngle = (point: Point, center: Point) => Math.atan2(point.y - center.y, point.x - center.x);
export const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const snappedIndex = (start: number, angle: number, count: number) =>
  wrapIndex(start + Math.round(angle * count / turn), count);

export function radialPosition(index: number, count: number, radius: number): Point {
  const angle = turn * index / count;
  return { x: 50 + radius * Math.sin(angle), y: 50 - radius * Math.cos(angle) };
}

export function clampFraction(fraction: number): number {
  return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : DEFAULT_DOCK.fraction;
}

export function dockFromPointer(point: Point, bounds: { left: number; top: number; width: number; height: number }, size: number): DockPosition {
  const travel = Math.max(0, bounds.height - size);
  return {
    edge: point.x < bounds.left + bounds.width / 2 ? 'left' : 'right',
    fraction: travel ? clampFraction((point.y - bounds.top - size / 2) / travel) : DEFAULT_DOCK.fraction,
  };
}

export function readDock(getItem: (key: string) => string | null): DockPosition {
  try {
    const value = JSON.parse(getItem(DOCK_KEY) ?? 'null') as Partial<DockPosition> | null;
    if (value && (value.edge === 'left' || value.edge === 'right') && typeof value.fraction === 'number') {
      return { edge: value.edge, fraction: clampFraction(value.fraction) };
    }
  } catch {
    // Invalid or unavailable storage falls back to the standard placement.
  }
  return DEFAULT_DOCK;
}
