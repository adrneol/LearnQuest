import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Compass, type LucideIcon } from 'lucide-react';
import { angleDelta, pointerAngle, radialPosition, snappedIndex, wrapIndex, type Point } from './geometry';
import { usePointerGesture } from './usePointerGesture';

interface Slot { label: string; icon: LucideIcon }
interface Props {
  slots: Slot[];
  selected: number;
  select: (index: number) => void;
  active: number;
  mirrored: boolean;
}

export function RadialDial({ slots, selected, select, active, mirrored }: Props) {
  const dial = useRef<HTMLDivElement>(null);
  const hand = useRef<SVGLineElement>(null);
  const rotation = useRef<{ center: Point; last: number; swept: number; start: number } | null>(null);
  const count = slots.length;
  const direction = mirrored ? -1 : 1;
  const handAngle = useRef(selected * 2 * Math.PI / count * direction);
  useLayoutEffect(() => {
    handAngle.current += angleDelta(handAngle.current, selected * 2 * Math.PI / count * direction);
    if (hand.current) hand.current.style.transform = 'rotate(' + handAngle.current + 'rad)';
  }, [count, direction, selected]);
  const gesture = usePointerGesture({
    start(event) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      const point = { x: event.clientX, y: event.clientY };
      if (Math.hypot(point.x - center.x, point.y - center.y) < bounds.width * .19) return false;
      rotation.current = { center, last: pointerAngle(point, center), swept: 0, start: selected };
      return true;
    },
    move(point) {
      const current = rotation.current;
      if (!current || Math.hypot(point.x - current.center.x, point.y - current.center.y) < 12) return;
      const angle = pointerAngle(point, current.center);
      current.swept += angleDelta(current.last, angle);
      current.last = angle;
      select(snappedIndex(current.start, current.swept * direction, count));
    },
    finish(cancelled) {
      if (cancelled && rotation.current) select(rotation.current.start);
      rotation.current = null;
    },
  });

  useEffect(() => {
    const element = dial.current;
    if (!element) return;
    let scroll = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || !element.contains(document.activeElement)) return;
      event.preventDefault();
      scroll += event.deltaY;
      if (Math.abs(scroll) < 32 && event.deltaMode === 0) return;
      select(wrapIndex(selected + Math.sign(scroll), count));
      scroll = 0;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [count, select, selected]);

  const keys = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const offsets: Record<string, number> = { ArrowLeft: -direction, ArrowUp: -1, ArrowRight: direction, ArrowDown: 1 };
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
      : offsets[event.key] ? wrapIndex(index + offsets[event.key], count) : null;
    if (next !== null) {
      event.preventDefault();
      select(next);
      dial.current?.querySelector<HTMLElement>('[data-slot="' + next + '"]')?.focus();
    }
  };

  return (
    <div ref={dial} className="lq-dial" role="group" aria-label="Sections" {...gesture}>
      <svg className="lq-dial-face" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="38" className="lq-dial-ring" />
        {Array.from({ length: 60 }, (_, tick) => (
          <line key={tick} x1="50" x2="50" y1={tick % 5 === 0 ? '7.5' : '9'} y2="11"
            transform={'rotate(' + tick * 6 + ' 50 50)'} className={tick % 5 === 0 ? 'lq-dial-major' : 'lq-dial-tick'} />
        ))}
        <line ref={hand} x1="50" y1="50" x2="50" y2="13" className="lq-dial-hand" />
      </svg>
      {slots.map(({ label, icon: Icon }, index) => {
        const position = radialPosition(index * direction, count, 34);
        return (
          <button key={label} type="button" data-slot={index} data-selected={index === selected}
            className="lq-dial-slot" style={{ left: position.x + '%', top: position.y + '%' } as CSSProperties}
            aria-pressed={index === selected} aria-current={index === active ? 'true' : undefined}
            aria-controls="workspace-section-links"
            onKeyDown={(event) => keys(event, index)} onClick={() => select(index)}>
            <Icon size={15} aria-hidden="true" /><span>{label}</span>
          </button>
        );
      })}
      <Compass className="lq-dial-center" size={18} aria-hidden="true" />
    </div>
  );
}
