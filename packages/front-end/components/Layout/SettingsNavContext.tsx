import {
  createContext,
  MutableRefObject,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/router";
import useMediaQuery from "@/hooks/useMediaQuery";
import { isSettingsRoute } from "./sidebarNav";
import { SETTINGS_NAV_MIN_WIDTH_PX } from "./constants";

type SettingsNavContextValue = {
  query: string;
  setQuery: (query: string) => void;
  activeSection: string;
  setActiveSection: (id: string) => void;
  /** Section a click or link jumped to; the scroll spy shows it until the user scrolls. */
  pinnedSection: MutableRefObject<string | null>;
  pinSection: (id: string) => void;
  counts: Record<string, number>;
  setCount: (sectionId: string, count: number | null) => void;
  searchRef: RefObject<HTMLInputElement>;
  /**
   * The narrow layout: the nav as a select at the page's top
   * (SettingsPageTop) and stacked cards, below SETTINGS_NAV_MIN_WIDTH_PX.
   */
  narrow: boolean;
};

const SettingsNavContext = createContext<SettingsNavContextValue | null>(null);

export function SettingsNavProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  // Clears on leaving Settings, not when the nav switches to the jump menu.
  const inSettings = isSettingsRoute(useRouter().route);
  useEffect(() => {
    if (!inSettings) setQuery("");
  }, [inSettings]);

  // CSS takes the narrow layout from its own media queries (global.scss),
  // from the first paint.
  const narrow = useMediaQuery(
    `(max-width: ${SETTINGS_NAV_MIN_WIDTH_PX - 1}px)`,
  );

  const [activeSection, setActiveSection] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const pinnedSection = useRef<string | null>(null);
  const pinSection = useCallback((id: string) => {
    pinnedSection.current = id;
    setActiveSection(id);
  }, []);

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
      pinnedSection,
      pinSection,
      counts,
      setCount,
      searchRef,
      narrow,
    }),
    [query, activeSection, counts, setCount, pinSection, narrow],
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
