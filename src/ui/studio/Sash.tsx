import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

interface SashProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** For panels on the right: dragging left makes them wider. */
  invert?: boolean;
  onChange: (v: number) => void;
}

/** A draggable, keyboard-adjustable divider between panels. */
export function Sash({ label, value, min, max, invert, onChange }: SashProps) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, v: value };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    onChange(clamp(start.current.v + (invert ? -dx : dx)));
  };
  const end = () => {
    start.current = null;
    document.body.classList.remove('resizing');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') onChange(clamp(value + (invert ? step : -step)));
    else if (e.key === 'ArrowRight') onChange(clamp(value + (invert ? -step : step)));
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="sash"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  );
}
