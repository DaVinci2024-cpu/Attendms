import { useEffect, useState } from "react";

// Returns false on the very first render, then true one frame later —
// pair with a className that interpolates between a hidden/offset state
// and its resting state (e.g. "opacity-0 scale-95" -> "opacity-100
// scale-100") plus a `transition` class, so anything using this actually
// animates in instead of just appearing. For a component that mounts
// once per appearance (a modal), call with no argument. For one that
// stays mounted and toggles its own open state (a dropdown menu), pass
// that boolean — it re-fires the enter animation each time it flips
// back to true, and resets instantly (no exit animation) when false.
export function useEnterTransition(active: boolean = true): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(active));
    return () => cancelAnimationFrame(id);
  }, [active]);

  return visible;
}
