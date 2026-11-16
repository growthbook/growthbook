import { useEffect, useRef, useState } from "react";

const DEFAULT_DELAY_MS = 500;

// Returns `value` once `key` has stopped changing for `delayMs`. A preview
// draft is rebuilt on every keystroke, so this keeps typing from firing a
// cache lookup per key. While `key` is unchanged it returns the same object,
// even if `value` was rebuilt.
export default function useDebouncedValue<T>(
  key: string,
  value: T,
  delayMs = DEFAULT_DELAY_MS,
): T {
  const valueRef = useRef(value);
  valueRef.current = value;
  const [debounced, setDebounced] = useState({ key, value });
  useEffect(() => {
    if (key === debounced.key) return;
    const timer = setTimeout(
      () => setDebounced({ key, value: valueRef.current }),
      delayMs,
    );
    return () => clearTimeout(timer);
  }, [key, debounced.key, delayMs]);
  return debounced.value;
}
