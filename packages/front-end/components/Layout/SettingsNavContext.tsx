import {
  createContext,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type SettingsNavContextValue = {
  query: string;
  setQuery: (query: string) => void;
  activeSection: string;
  setActiveSection: (id: string) => void;
  /** Matching cards per General section. Only populated while a query is set. */
  counts: Record<string, number>;
  setCount: (sectionId: string, count: number | null) => void;
  searchRef: RefObject<HTMLInputElement>;
};

const SettingsNavContext = createContext<SettingsNavContextValue | null>(null);

export function SettingsNavProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const setCount = useCallback((id: string, count: number | null) => {
    setCounts((prev) => {
      if ((count === null && !(id in prev)) || prev[id] === count) return prev;
      const next = { ...prev };
      if (count === null) delete next[id];
      else next[id] = count;
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      activeSection,
      setActiveSection,
      counts,
      setCount,
      searchRef,
    }),
    [query, activeSection, counts, setCount],
  );

  return (
    <SettingsNavContext.Provider value={value}>
      {children}
    </SettingsNavContext.Provider>
  );
}

export function useSettingsNav() {
  const ctx = useContext(SettingsNavContext);
  if (!ctx) {
    throw new Error("useSettingsNav must be used within SettingsNavProvider");
  }
  return ctx;
}
