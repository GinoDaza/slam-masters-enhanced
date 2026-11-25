import { useEffect, useRef } from 'react';

/** Esc (and the gamepad's B, nav.ts) goes back. */
export function useBack(onBack: () => void): void {
  const f = useRef(onBack);
  f.current = onBack;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat) f.current();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
