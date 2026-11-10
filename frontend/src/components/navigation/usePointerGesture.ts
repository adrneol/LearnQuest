import { useRef, type PointerEvent, type MouseEvent } from 'react';
import { GESTURE_THRESHOLD, type Point } from './geometry';

interface Gesture {
  id: number;
  start: Point;
  moved: boolean;
  target: Element;
}

interface Options {
  start?: (event: PointerEvent<HTMLElement>) => boolean;
  move: (point: Point) => void;
  finish?: (cancelled: boolean) => void;
}

export function usePointerGesture({ start, move, finish }: Options) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const end = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    gesture.current = null;
    if (current.target.hasPointerCapture?.(current.id)) current.target.releasePointerCapture(current.id);
    if (current.moved) {
      suppressClick.current = true;
      finish?.(cancelled);
    }
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || gesture.current) return;
      suppressClick.current = false;
      if (start?.(event) === false) return;
      const target = event.target as Element;
      gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false, target };
      target.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (current?.id !== event.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < GESTURE_THRESHOLD) return;
      current.moved = true;
      move({ x: event.clientX, y: event.clientY });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => end(event, true),
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
