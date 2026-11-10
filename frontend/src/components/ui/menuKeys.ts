export function moveMenuFocus(menu: HTMLElement | null, key: string): boolean {
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return false;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(
    'button[role^="menuitem"]:not(:disabled)',
  ));
  if (!items.length) return false;
  const active = items.indexOf(document.activeElement as HTMLButtonElement);
  const last = items.length - 1;
  const next = key === 'Home' ? 0
    : key === 'End' ? last
    : key === 'ArrowDown' ? (active + 1) % items.length
    : active <= 0 ? last : active - 1;
  items[next].focus();
  return true;
}
