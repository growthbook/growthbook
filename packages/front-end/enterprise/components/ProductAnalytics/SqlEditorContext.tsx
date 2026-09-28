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
import { AceCompletion } from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import useSqlAutocomplete from "@/components/SchemaBrowser/useSqlAutocomplete";
import type { ExplorerDraftConfig } from "@/enterprise/components/ProductAnalytics/util";

export type SqlEditorViewMode = "dataset" | "explore";

interface SqlEditorContextValue {
  localSql: string;
  setLocalSql: (sql: string) => void;
  autoCompletions: AceCompletion[];
  cursorData: CursorData | null;
  isAutocompleteEnabled: boolean;
  setCursorData: (cursorData: CursorData | null) => void;
  setIsAutocompleteEnabled: (enabled: boolean) => void;
  viewMode: SqlEditorViewMode;
  setViewMode: (viewMode: SqlEditorViewMode) => void;
  isQueryRunning: boolean;
  setIsQueryRunning: (running: boolean) => void;
  /** SqlQuerySection registers its preview runner so callers outside the editor
   *  (e.g. the dashboard block's Update) can refresh column metadata first. */
  registerPreviewRunner: (
    fn: ((sql: string) => Promise<ExplorerDraftConfig | null>) | null,
  ) => void;
  /** Resolves null when no runner is registered or the preview failed;
   *  otherwise the draft config carrying the refreshed column metadata. */
  runPreview: (sql: string) => Promise<ExplorerDraftConfig | null>;
  exploreReady: boolean;
  setExploreReady: (ready: boolean) => void;
  // True after the user opens Explore; cleared when exploreReady is reset so a
  // fresh successful test can show the "ready" cue again.
  hasSeenExplore: boolean;
  markExploreSeen: () => void;
}

const SqlEditorContext = createContext<SqlEditorContextValue | null>(null);

export function SqlEditorProvider({
  children,
  datasourceId,
  sql,
  initialViewMode,
}: {
  children: ReactNode;
  datasourceId: string;
  sql: string;
  initialViewMode: SqlEditorViewMode;
}) {
  const [localSql, setLocalSql] = useState(sql);
  const [viewMode, setViewMode] = useState<SqlEditorViewMode>(initialViewMode);
  const [isQueryRunning, setIsQueryRunning] = useState(false);
  const [exploreReady, setExploreReadyState] = useState(
    initialViewMode === "explore",
  );
  const [hasSeenExplore, setHasSeenExplore] = useState(
    initialViewMode === "explore",
  );
  const {
    autoCompletions,
    cursorData,
    isAutocompleteEnabled,
    setCursorData,
    setIsAutocompleteEnabled,
  } = useSqlAutocomplete({
    datasourceId,
    source: "SqlExplorer",
    skipManagedWarehouseUnavailable: true,
  });

  useEffect(() => {
    setLocalSql(sql);
  }, [sql]);

  const previewRunnerRef = useRef<
    ((sql: string) => Promise<ExplorerDraftConfig | null>) | null
  >(null);
  const registerPreviewRunner = useCallback(
    (fn: ((sql: string) => Promise<ExplorerDraftConfig | null>) | null) => {
      previewRunnerRef.current = fn;
    },
    [],
  );
  const runPreview = useCallback(
    (sql: string) => previewRunnerRef.current?.(sql) ?? Promise.resolve(null),
    [],
  );

  const setExploreReady = useCallback((ready: boolean) => {
    setExploreReadyState(ready);
    // A new test cycle can show the ready cue again.
    if (!ready) setHasSeenExplore(false);
  }, []);

  const markExploreSeen = useCallback(() => setHasSeenExplore(true), []);

  const value = useMemo(
    () => ({
      localSql,
      setLocalSql,
      autoCompletions,
      cursorData,
      isAutocompleteEnabled,
      setCursorData,
      setIsAutocompleteEnabled,
      viewMode,
      setViewMode,
      isQueryRunning,
      setIsQueryRunning,
      registerPreviewRunner,
      runPreview,
      exploreReady,
      setExploreReady,
      hasSeenExplore,
      markExploreSeen,
    }),
    [
      autoCompletions,
      cursorData,
      exploreReady,
      hasSeenExplore,
      isAutocompleteEnabled,
      isQueryRunning,
      localSql,
      markExploreSeen,
      registerPreviewRunner,
      runPreview,
      setCursorData,
      setExploreReady,
      setIsAutocompleteEnabled,
      viewMode,
    ],
  );

  return (
    <SqlEditorContext.Provider value={value}>
      {children}
    </SqlEditorContext.Provider>
  );
}

export function useSqlEditorContext(): SqlEditorContextValue {
  const context = useContext(SqlEditorContext);
  if (!context) {
    throw new Error(
      "useSqlEditorContext must be used within a SqlEditorProvider",
    );
  }
  return context;
}

export function useOptionalSqlEditorContext(): SqlEditorContextValue | null {
  return useContext(SqlEditorContext);
}
