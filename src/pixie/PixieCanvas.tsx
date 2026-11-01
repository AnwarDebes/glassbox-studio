import { useEffect, useRef } from 'react';
import { PixieRenderer, type PixieState } from './renderer';
import { useReducedMotion } from '../ui/hooks';

interface PixieCanvasProps {
  state: PixieState;
  className?: string;
  /** Accessible description; the canvas is decorative when omitted. */
  label?: string;
}

/** A canvas that draws Pixie in the given pose. */
export function PixieCanvas({ state, className, label }: PixieCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PixieRenderer | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!ref.current) return;
    const r = new PixieRenderer(ref.current, { reducedMotion: reduced });
    renderer.current = r;
    r.setState(state);
    return () => {
      r.destroy();
      renderer.current = null;
    };
    // The renderer is created once; state and motion changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    renderer.current?.setState(state);
  }, [state]);

  useEffect(() => {
    renderer.current?.setReducedMotion(reduced);
  }, [reduced]);

  return (
    <canvas
      ref={ref}
      className={className ? `pixie-canvas ${className}` : 'pixie-canvas'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
