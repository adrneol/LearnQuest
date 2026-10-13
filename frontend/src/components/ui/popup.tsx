import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Pos {
  top: number | null;
  bottom: number | null;
  left: number;
  width: number;
  maxH: number;
}

interface Props {
  anchor: () => HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  minHeight?: number;
}

/**
 * Portal popup: renders into document.body with fixed positioning, so no
 * scrollable card, grid, backdrop-filter panel, or sidebar can clip it.
 * Flips upward when room below is tight, clamps horizontally to the viewport,
 * and follows scroll/resize. Escape + outside interaction close it.
 */
export function PopupShell({ anchor, open, onClose, children, minHeight = 200 }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchor();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, 180), vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      const below = vh - r.bottom - 8;
      const above = r.top - 8;
      const up = below < minHeight && above > below;
      const maxH = Math.max(140, Math.min(320, (up ? above : below) - 4));
      setPos(
        up
          ? { top: null, bottom: Math.max(4, vh - r.top + 4), left, width, maxH }
          : { top: Math.min(r.bottom + 4, vh - 8), bottom: null, left, width, maxH },
      );
    };
    place();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const el = anchor();
      if (el && !el.contains(t) && shellRef.current && !shellRef.current.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={shellRef}
      role="presentation"
      className="fixed z-[70] overflow-hidden rounded-xl border border-white/15 bg-[#141830] shadow-2xl"
      style={{
        top: pos.top ?? undefined,
        bottom: pos.bottom ?? undefined,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxH,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
