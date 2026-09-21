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
type ManagedFlagMap = Record<string, string>;

interface UseManagedExperimentFlagStatesReturn {
  /** Loads the ids not already known; safe to call on every visible-row change. */
  fetchSome: (experimentIds: string[]) => Promise<void>;
  /** The flag an experiment manages, or undefined if it manages none. */
  getManagedFlag: (experimentId: string) => string | undefined;
}

const ManagedFlagsContext =
  createContext<UseManagedExperimentFlagStatesReturn | null>(null);

// Ownership lives on the flag, so a list row must ask. Follows
// `FeatureStaleStatesProvider`: the caller passes the rows on screen.
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
        // Resolve every requested id, or the empty ones refetch on every scroll.
        toFetch.forEach((id) => resolvedIds.current.add(id));
        setManaged((prev) => ({ ...prev, ...(res.managed ?? {}) }));
      } catch (e) {
        // Swallowed: this decorates an icon, and the next row change retries.
        console.error("Could not resolve managed experiments", e);
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
