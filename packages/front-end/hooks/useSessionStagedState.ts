import {
  Dispatch,
  SetStateAction,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Nothing staged: the slot reads as its caller's `initial`, so it follows what
// is stored until someone changes it.
const UNSET: unique symbol = Symbol("unset");
type Stored<T> = T | typeof UNSET;

// One value per key, shared by every component staging it and kept in
// sessionStorage, so a reload or a second view of the same slot agrees.
const stagedValues = new Map<string, unknown>();
const stagedListeners = new Map<string, Set<() => void>>();

function readStaged(key: string): unknown {
  if (!stagedValues.has(key)) {
    let value: unknown = UNSET;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) value = JSON.parse(stored);
    } catch {
      // Unavailable storage leaves it unstaged.
    }
    stagedValues.set(key, value);
  }
  return stagedValues.get(key);
}

function writeStaged(key: string, value: unknown) {
  stagedValues.set(key, value);
  try {
    if (value === UNSET) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept in memory for this page view.
  }
  stagedListeners.get(key)?.forEach((listener) => listener());
}

function subscribeStaged(key: string, listener: () => void) {
  const listeners = stagedListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  stagedListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stagedListeners.delete(key);
  };
}

/**
 * State that waits for a page's Save, shared by every component staging the
 * same key and kept for the session. Set back to `initial`, it's unstaged and
 * follows `initial` again. With no key, it's the caller's alone.
 */
export default function useSessionStagedState<T>(
  key: string | null,
  initial: T,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [local, setLocal] = useState<Stored<T>>(UNSET);
  const subscribe = useCallback(
    (listener: () => void) =>
      key ? subscribeStaged(key, listener) : () => undefined,
    [key],
  );
  const shared = useSyncExternalStore(
    subscribe,
    () => (key ? readStaged(key) : UNSET),
    () => UNSET,
  );
  const stored = (key ? shared : local) as Stored<T>;
  const value = stored === UNSET ? initial : stored;

  const latest = useRef({ key, initial });
  latest.current = { key, initial };
  const set: Dispatch<SetStateAction<T>> = useCallback((next) => {
    const { key, initial } = latest.current;
    const resolve = (prev: Stored<T>): Stored<T> => {
      const from = prev === UNSET ? initial : prev;
      const to =
        typeof next === "function" ? (next as (prev: T) => T)(from) : next;
      return JSON.stringify(to) === JSON.stringify(initial) ? UNSET : to;
    };
    if (key) writeStaged(key, resolve(readStaged(key) as Stored<T>));
    else setLocal(resolve);
  }, []);
  // Back to following `initial`, whatever it is by then.
  const clear = useCallback(() => {
    const { key } = latest.current;
    if (key) writeStaged(key, UNSET);
    else setLocal(UNSET);
  }, []);
  return [value, set, clear];
}
