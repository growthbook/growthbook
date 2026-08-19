import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
  createElement,
} from "react";
import { useAuth } from "@/services/auth";

/** experiment id -> the Feature Flag key it manages */
export type ManagedFlagMap = Record<string, string>;

export interface UseManagedExperimentFlagStatesReturn {
  /** Loads the ids not already known; safe to call on every visible-row change. */
  fetchSome: (experimentIds: string[]) => Promise<void>;
  /** The flag an experiment manages, or undefined if it manages none. */
  getManagedFlag: (experimentId: string) => string | undefined;
}

const ManagedFlagsContext =
  createContext<UseManagedExperimentFlagStatesReturn | null>(null);

/**
 * JIT enrichment for experiment lists, mirroring `FeatureStaleStatesProvider`:
 * ownership lives on the Feature Flag, so a row cannot tell whether it manages
 * one without asking. Fetching is driven by the rows actually on screen, so a
 * long list costs no more than a short one.
 *
 * No TTL refresh, unlike the stale-state provider — managed mode only changes
 * when someone adopts or ejects on the experiment page, which remounts this.
 */
export function ManagedExperimentFlagsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const [managed, setManaged] = useState<ManagedFlagMap>({});
  const resolvedIds = useRef(new Set<string>());
  const inflightKey = useRef<string | null>(null);

  const fetchSome = useCallback(
    async (experimentIds: string[]) => {
      const toFetch = experimentIds.filter(
        (id) => !resolvedIds.current.has(id),
      );
      if (!toFetch.length) return;

      const key = [...toFetch].sort().join(",");
      if (inflightKey.current === key) return;
      inflightKey.current = key;
      try {
        const res = await apiCall<{ managed: ManagedFlagMap }>(
          `/experiments/managed?ids=${encodeURIComponent(toFetch.join(","))}`,
        );
        // Every requested id is resolved, including the ones with no managed
        // flag — otherwise they would be re-fetched on every scroll.
        toFetch.forEach((id) => resolvedIds.current.add(id));
        setManaged((prev) => ({ ...prev, ...(res.managed ?? {}) }));
      } finally {
        inflightKey.current = null;
      }
    },
    [apiCall],
  );

  const getManagedFlag = useCallback(
    (experimentId: string) => managed[experimentId],
    [managed],
  );

  return createElement(
    ManagedFlagsContext.Provider,
    { value: { fetchSome, getManagedFlag } },
    children,
  );
}

/** Returns a no-op outside the provider, so lists can opt in without coupling. */
const NOOP: UseManagedExperimentFlagStatesReturn = {
  fetchSome: async () => {},
  getManagedFlag: () => undefined,
};

export function useManagedExperimentFlagStates(): UseManagedExperimentFlagStatesReturn {
  return useContext(ManagedFlagsContext) ?? NOOP;
}
