import { useEffect, useRef } from "react";

/**
 * Compose multiple updates fired within the same tick without waiting for a
 * re-render.
 *
 * Props/state are stale inside a single event handler, so two setter calls in
 * the same tick each read the pre-update value and the second clobbers the
 * first. (This bites range/date pickers, whose calendars call `setFrom` and
 * `setTo` back-to-back.) This keeps the latest value in a ref that is updated
 * synchronously, so consecutive updates compose.
 *
 * Returns an `apply` function that takes a reducer deriving the next value from
 * the latest one. The reducer may return `undefined` to abort — no value is
 * committed and `onChange` is not called.
 */
export function useMergedUpdates<T>(
  value: T,
  onChange: (next: T) => void,
): (update: (current: T) => T | undefined) => void {
  const latestRef = useRef(value);
  useEffect(() => {
    latestRef.current = value;
  }, [value]);

  return (update) => {
    const next = update(latestRef.current);
    if (next === undefined) return;
    latestRef.current = next;
    onChange(next);
  };
}
