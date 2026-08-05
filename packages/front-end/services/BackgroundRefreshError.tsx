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
  // Track/untrack an SWR key whose background refresh is currently failing.
  report: (key: string, error: Error) => void;
  clear: (key: string) => void;
}

const BackgroundRefreshErrorContext =
  createContext<BackgroundRefreshErrorContextValue | null>(null);

// null outside the provider (e.g. pre-auth pages); callers must no-op on null.
export function useBackgroundRefreshError() {
  return useContext(BackgroundRefreshErrorContext);
}

// Debounce so a transient blip fixed by the next retry never flashes a toast.
const SHOW_DELAY_MS = 4000;

export function BackgroundRefreshErrorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { mutate } = useSWRConfig();

  // Ref (not state): batched report()/clear() calls avoid setState storms.
  const erroringKeys = useRef<Map<string, Error>>(new Map());

  const [visible, setVisible] = useState(false);
  // Mirrors `visible` so the stable callbacks below can read it without depending on it.
  const shownRef = useRef(false);
  // Keys failing when the user dismissed; null = not dismissed. Re-show only for keys outside it.
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
      clearTimer();
      dismissedKeysRef.current = null;
      if (shownRef.current) setShown(false);
      return;
    }

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
      // A failure outside the dismiss snapshot is a new problem — undo the dismissal.
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
        // Prune from the dismiss snapshot so a later re-failure can show again.
        dismissedKeysRef.current?.delete(key);
        recompute();
      }
    },
    [recompute],
  );

  const retryNow = useCallback(async () => {
    // Snapshot keys so a concurrent clear()/report() can't change the set.
    const keys = new Set(erroringKeys.current.keys());
    await mutate((key) => typeof key === "string" && keys.has(key));
  }, [mutate]);

  const onDismiss = useCallback(() => {
    dismissedKeysRef.current = new Set(erroringKeys.current.keys());
    clearTimer();
    setShown(false);
  }, [clearTimer, setShown]);

  // Clear any pending timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  // Stable identity so consumers' effects don't re-run each render.
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
