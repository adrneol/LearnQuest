// Minimal transient notification bus (toasts). Used for save confirmations and
// non-blocking feedback — celebrations for goals/checkpoints use the store's
// celebration channel instead.

export interface Notice {
  id: string;
  text: string;
  at: number;
}

type Listener = (n: Notice[]) => void;

let notices: Notice[] = [];
const listeners = new Set<Listener>();
let counter = 0;

export function notify(text: string): void {
  const n: Notice = { id: `${Date.now()}-${counter++}`, text, at: Date.now() };
  notices = [...notices.slice(-2), n];
  for (const l of listeners) l(notices);
  setTimeout(() => {
    notices = notices.filter((x) => x.id !== n.id);
    for (const l of listeners) l(notices);
  }, 4000);
}

export function subscribeNotices(l: Listener): () => void {
  listeners.add(l);
  l(notices);
  return () => {
    listeners.delete(l);
  };
}
