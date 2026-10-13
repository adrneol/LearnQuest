import { useEffect, useState } from 'react';
import { subscribeNotices, type Notice } from '../../services/notifications/notify.js';

export function Notifier() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => subscribeNotices(setItems), []);
  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-1.5" role="status" aria-live="polite">
      {items.map((n) => (
        <p key={n.id} className="rounded-xl border border-white/15 bg-black/80 px-4 py-2 text-sm text-slate-100 shadow-2xl backdrop-blur">
          {n.text}
        </p>
      ))}
    </div>
  );
}
