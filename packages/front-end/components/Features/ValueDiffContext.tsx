import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import isEqual from "lodash/isEqual";

type ShownObject = Record<string, unknown>;

const ValueDiffContext = createContext<{
  report: (id: string, value: ShownObject | null) => void;
  differingKeys: Set<string> | null;
} | null>(null);

// Wraps values shown side by side, like an experiment's variations, so each
// can mark the top-level fields where they differ.
export function ValueDiffProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, ShownObject>>({});
  const report = useCallback((id: string, value: ShownObject | null) => {
    setValues((prev) => {
      if (value === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev[id] === value ? prev : { ...prev, [id]: value };
    });
  }, []);
  const differingKeys = useMemo(() => {
    const shown = Object.values(values);
    if (shown.length < 2) return null;
    const keys = new Set(shown.flatMap((v) => Object.keys(v)));
    const differing = new Set(
      [...keys].filter((k) => shown.some((v) => !isEqual(v[k], shown[0][k]))),
    );
    // Marking every field says nothing when none is the same in every value.
    return differing.size === keys.size ? new Set<string>() : differing;
  }, [values]);
  const context = useMemo(
    () => ({ report, differingKeys }),
    [report, differingKeys],
  );
  return (
    <ValueDiffContext.Provider value={context}>
      {children}
    </ValueDiffContext.Provider>
  );
}

// Reports the object a value display shows, and returns the fields where the
// values in the same provider differ: null outside one.
export function useValueDiff(shown: ShownObject | null): Set<string> | null {
  const context = useContext(ValueDiffContext);
  const report = context?.report;
  const id = useId();
  useEffect(() => {
    if (!report || shown === null) return;
    report(id, shown);
    return () => report(id, null);
  }, [report, id, shown]);
  return context?.differingKeys ?? null;
}
