import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AceCompletion } from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import useSqlAutocomplete from "@/components/SchemaBrowser/useSqlAutocomplete";

export type SqlEditorViewMode = "chart" | "results" | "sql";

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
  isQueryActive: boolean;
  setIsQueryActive: (active: boolean) => void;
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
  const [viewMode, setViewMode] =
    useState<SqlEditorViewMode>(initialViewMode);
  const [isQueryActive, setIsQueryActive] = useState(false);
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
      isQueryActive,
      setIsQueryActive,
    }),
    [
      autoCompletions,
      cursorData,
      isAutocompleteEnabled,
      isQueryActive,
      localSql,
      setCursorData,
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
