/**
 * One-shot cross-route intent handoff.
 *
 * Hash routing has no typed query state, and persisting transient UI intents
 * in the URL or in module globals that outlive a reload causes stale prefills.
 * This module keeps exactly one in-memory intent: set just before navigating
 * (`setPendingIntent`), consumed once on the target screen's mount
 * (`consumePendingIntent`). It is never persisted, never crosses a reload, and
 * never affects which route is shown.
 */
export type PendingIntent =
  | { kind: 'focus-orphan-review' }
  | { kind: 'checkpoint-from-range'; playlistId: string; start: number; end: number; label: string };

let pending: PendingIntent | null = null;

export function setPendingIntent(intent: PendingIntent): void {
  pending = intent;
}

export function consumePendingIntent<T extends PendingIntent['kind']>(
  kind: T,
): Extract<PendingIntent, { kind: T }> | null {
  if (pending?.kind !== kind) return null;
  const intent = pending;
  pending = null;
  return intent as Extract<PendingIntent, { kind: T }>;
}
