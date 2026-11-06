import {
  createContext,
  MutableRefObject,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/router";
import useMediaQuery from "@/hooks/useMediaQuery";
import { isSettingsRoute } from "./sidebarNav";
import {
  SETTINGS_NAV_MIN_WIDTH_PX,
  SETTINGS_WIDE_MIN_PAGE_AREA_PX,
} from "./constants";

// Before paint in the browser, as a plain effect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
   * (SettingsPageTop) and stacked cards. On a narrow window, or when the
   * docked AI panel leaves too little room beside the side nav.
   */
  narrow: boolean;
};

const SettingsNavContext = createContext<SettingsNavContextValue | null>(null);

export function SettingsNavProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  // Clears on leaving Settings, not when the nav moves into the header.
  const inSettings = isSettingsRoute(useRouter().route);
  useEffect(() => {
    if (!inSettings) setQuery("");
  }, [inSettings]);

  // A narrow window gets the narrow layout from CSS too (global.scss), from
  // the first paint.
  const narrowWindow = useMediaQuery(
    `(max-width: ${SETTINGS_NAV_MIN_WIDTH_PX - 1}px)`,
  );
  // Crowded: the docked AI panel leaves less page area than the wide layout
  // needs. Only while it's docked, so without it nothing changes. The probe
  // (below) is the page area itself, outside the Settings page, so Settings'
  // own layout never changes what it measures, and it can't flip back and
  // forth. It follows the panel's target width, not its slide.
  const [crowded, setCrowded] = useState(false);
  const probeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = probeRef.current;
    if (!inSettings || !el) {
      setCrowded(false);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const docked =
        document.documentElement.style.getPropertyValue(
          "--agent-rail-width",
        ) !== "";
      setCrowded(
        docked && entry.contentRect.width < SETTINGS_WIDE_MIN_PAGE_AREA_PX,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [inSettings]);
  const narrow = narrowWindow || crowded;
  // For Settings' CSS, beside its narrow-window media queries.
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("settings-narrow", inSettings && narrow);
    return () => root.classList.remove("settings-narrow");
  }, [inSettings, narrow]);

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
      {inSettings ? (
        <div
          ref={probeRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            height: 0,
            width: "var(--page-area-width)",
            visibility: "hidden",
            pointerEvents: "none",
          }}
        />
      ) : null}
      {children}
    </SettingsNavContext.Provider>
  );
}

/** Settings' narrow layout; false outside the provider. */
export function useSettingsNarrow(): boolean {
  return useContext(SettingsNavContext)?.narrow ?? false;
}

export function useSettingsNav() {
  const ctx = useContext(SettingsNavContext);
  if (!ctx) {
    throw new Error("useSettingsNav must be used within SettingsNavProvider");
  }
  return ctx;
}
