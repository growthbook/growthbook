import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSWRConfig } from "swr";
import Toast from "@/ui/Toast";

interface BackgroundRefreshErrorContextValue {
  // Register/clear an SWR key that is currently failing a *background* refresh
  // (i.e. we still have stale data to show). See `useApi`.
  report: (key: string, error: Error) => void;
  clear: (key: string) => void;
}

const BackgroundRefreshErrorContext =
  createContext<BackgroundRefreshErrorContextValue | null>(null);

/**
 * Returns the background-refresh-error reporter, or `null` when used outside the
 * provider (e.g. pre-auth pages). Callers must no-op when it's null.
 */
export function useBackgroundRefreshError() {
  return useContext(BackgroundRefreshErrorContext);
}

// Only surface the toast once a refresh has been failing for at least this long,
// so a transient blip that the next retry fixes never flashes a toast.
const SHOW_DELAY_MS = 4000;

export function BackgroundRefreshErrorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { mutate } = useSWRConfig();

  // Source of truth for which SWR keys are currently failing. A ref (not state)
  // so the many report()/clear() calls that fire together (e.g. when offline,
  // every request on the page fails at once) don't cause setState storms or
  // stale-closure races — they all collapse into a single toast.
  const erroringKeys = useRef<Map<string, Error>>(new Map());

  const [visible, setVisible] = useState(false);
  // Mirrors `visible` so the stable callbacks below can read it without
  // depending on it (which would change their identity and re-run every
  // consumer's effect).
  const shownRef = useRef(false);
  // When the user dismisses, we snapshot the keys that were failing at that
  // moment. We stay hidden until a key *outside* this snapshot starts failing (a
  // brand-new problem) — a key that was already failing throwing a fresh Error on
  // its next revalidation must not re-show the toast. `null` means "not dismissed".
  const dismissedKeysRef = useRef<Set<string> | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setShown = useCallback((next: boolean) => {
    shownRef.current = next;
    setVisible(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }, []);

  const recompute = useCallback(() => {
    const hasErrors = erroringKeys.current.size > 0;

    if (!hasErrors) {
      // Everything recovered (or unmounted) — reset and hide.
      clearTimer();
      dismissedKeysRef.current = null;
      if (shownRef.current) setShown(false);
      return;
    }

    // User dismissed, or we're already showing / already waiting to show.
    if (
      dismissedKeysRef.current !== null ||
      shownRef.current ||
      showTimer.current
    ) {
      return;
    }

    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      if (erroringKeys.current.size > 0 && dismissedKeysRef.current === null) {
        setShown(true);
      }
    }, SHOW_DELAY_MS);
  }, [clearTimer, setShown]);

  const report = useCallback(
    (key: string, error: Error) => {
      erroringKeys.current.set(key, error);
      // A failure of a key the user didn't dismiss is a brand-new problem, so
      // undo the dismissal. Keys in the dismiss snapshot stay suppressed even
      // when they throw a fresh Error on a later revalidation.
      const dismissedKeys = dismissedKeysRef.current;
      if (dismissedKeys && !dismissedKeys.has(key)) {
        dismissedKeysRef.current = null;
      }
      recompute();
    },
    [recompute],
  );

  const clear = useCallback(
    (key: string) => {
      if (erroringKeys.current.delete(key)) {
        recompute();
      }
    },
    [recompute],
  );

  const retryNow = useCallback(async () => {
    // Snapshot the failing keys so a concurrent clear()/report() between here and
    // SWR iterating its cache can't change which keys we revalidate.
    const keys = new Set(erroringKeys.current.keys());
    await mutate((key) => typeof key === "string" && keys.has(key));
  }, [mutate]);

  const onDismiss = useCallback(() => {
    dismissedKeysRef.current = new Set(erroringKeys.current.keys());
    clearTimer();
    setShown(false);
  }, [clearTimer, setShown]);

  // Clean up a pending timer if the provider itself unmounts.
  useEffect(() => clearTimer, [clearTimer]);

  // Stable identity — report/clear never change, so consumers' effects don't
  // re-run on every provider render.
  const value = useMemo<BackgroundRefreshErrorContextValue>(
    () => ({ report, clear }),
    [report, clear],
  );

  return (
    <BackgroundRefreshErrorContext.Provider value={value}>
      {children}
      {visible ? (
        <Toast
          status="warning"
          action={{ label: "Retry", onClick: retryNow }}
          onDismiss={onDismiss}
        >
          Couldn&rsquo;t refresh the latest data.
        </Toast>
      ) : null}
    </BackgroundRefreshErrorContext.Provider>
  );
}
