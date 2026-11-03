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
import { parsePlainJSONObject } from "shared/util";
import { getFieldLineNumbers } from "./jsonFieldLines";

type ShownObject = Record<string, unknown>;

// Edited text longer than this isn't compared: parsing and comparing it on
// every keystroke makes typing lag.
const MAX_COMPARED_LENGTH = 200_000;
// Reported in place of such a value. Comparing only the others would mark the
// wrong fields, so it turns comparison off for the whole set.
const TOO_LARGE = "too large";
type Shown = ShownObject | typeof TOO_LARGE;

const ValueDiffContext = createContext<{
  report: (id: string, value: Shown | null) => void;
  differingKeys: Set<string> | null;
} | null>(null);

// The top-level fields where the values differ: null when there's nothing to
// compare.
function getDifferingKeys(values: Record<string, Shown>): Set<string> | null {
  const all = Object.values(values);
  if (all.length < 2) return null;
  const shown = all.filter((v): v is ShownObject => v !== TOO_LARGE);
  if (shown.length < all.length) return null;
  const keys = new Set(shown.flatMap((v) => Object.keys(v)));
  const differing = new Set(
    [...keys].filter((k) => shown.some((v) => !isEqual(v[k], shown[0][k]))),
  );
  // Marking every field says nothing when none is the same in every value.
  return differing.size === keys.size ? new Set<string>() : differing;
}

const sameKeys = (a: Set<string> | null, b: Set<string> | null) =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every((k) => b.has(k)));

// Wraps values shown side by side, like an experiment's variations, so each
// can mark the top-level fields where they differ.
export function ValueDiffProvider({ children }: { children: ReactNode }) {
  const [{ differingKeys }, setState] = useState<{
    values: Record<string, Shown>;
    differingKeys: Set<string> | null;
  }>({ values: {}, differingKeys: null });
  const report = useCallback((id: string, value: Shown | null) => {
    setState((prev) => {
      let values = prev.values;
      if (value === null) {
        if (!(id in values)) return prev;
        values = { ...values };
        delete values[id];
      } else {
        if (values[id] === value) return prev;
        values = { ...values, [id]: value };
      }
      const next = getDifferingKeys(values);
      // Same fields, same Set: a keystroke that moves no field re-renders
      // nothing that reads the context.
      return {
        values,
        differingKeys: sameKeys(prev.differingKeys, next)
          ? prev.differingKeys
          : next,
      };
    });
  }, []);
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
export function useValueDiff(shown: Shown | null): Set<string> | null {
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

// Reports a JSON value being edited, for the values beside it to compare
// against, and returns the fields where they differ. `sparseBase` is the value
// a sparse patch merges onto; null when the text is the whole value. Null text
// reports nothing.
export function useReportedJsonValue(
  text: string | null,
  sparseBase: string | null,
): Set<string> | null {
  // Nothing compares outside a provider, so skip the parse.
  const comparing = useContext(ValueDiffContext) !== null;
  const shown = useMemo((): Shown | null => {
    if (!comparing || text === null) return null;
    if (text.length > MAX_COMPARED_LENGTH) return TOO_LARGE;
    const value = parsePlainJSONObject(text);
    if (!value || sparseBase === null) return value;
    return { ...(parsePlainJSONObject(sparseBase) ?? {}), ...value };
  }, [comparing, text, sparseBase]);
  return useValueDiff(shown);
}

// For a whole-value JSON editor: the lines of its text whose fields differ from
// the other values in the same provider.
export function useEditorDiffLines(text: string | null): number[] {
  const differingKeys = useReportedJsonValue(text, null);
  return useMemo(
    () =>
      text !== null && differingKeys
        ? getFieldLineNumbers(text, differingKeys)
        : [],
    [text, differingKeys],
  );
}
