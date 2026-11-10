export interface Box { left: number; top: number; right: number; bottom: number }

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Try adjacent placements in viewport coordinates, allowing an edge clamp only on the free axis. */
export function tooltipPosition(anchor: { x: number; y: number }, width: number, height: number,
  viewport: Box, obstacles: readonly Box[], plot?: Box) {
  const inset = 8;
  const gap = 12;
  const left = viewport.left + inset;
  const right = viewport.right - inset;
  const top = viewport.top + inset;
  const bottom = viewport.bottom - inset;
  if (anchor.x < left || anchor.x > right || anchor.y < viewport.top || anchor.y > viewport.bottom) return undefined;
  if (obstacles.some((box) => anchor.x >= box.left && anchor.x <= box.right && anchor.y >= box.top && anchor.y <= box.bottom)) return undefined;
  const centerX = Math.max(left, Math.min(right - width, anchor.x - width / 2));
  const centerY = Math.max(top, Math.min(bottom - height, anchor.y - height / 2));
  const sides = [{ x: anchor.x + gap, y: centerY }, { x: anchor.x - width - gap, y: centerY }];
  if (anchor.x > (left + right) / 2) sides.reverse();
  const candidates = [...sides, { x: centerX, y: anchor.y - height - gap }, { x: centerX, y: anchor.y + gap }];
  const available = candidates.filter(({ x, y }) => x >= left && x + width <= right && y >= top && y + height <= bottom
    && !obstacles.some((box) => overlaps({ left: x, top: y, right: x + width, bottom: y + height }, box)));
  if (plot) {
    const overlapArea = ({ x, y }: { x: number; y: number }) =>
      Math.max(0, Math.min(x + width, plot.right) - Math.max(x, plot.left))
      * Math.max(0, Math.min(y + height, plot.bottom) - Math.max(y, plot.top));
    available.sort((a, b) => overlapArea(a) - overlapArea(b));
  }
  return available[0];
}
