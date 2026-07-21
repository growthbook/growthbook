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

interface SqlEditorContextValue {
  localSql: string;
  setLocalSql: (sql: string) => void;
  autoCompletions: AceCompletion[];
  cursorData: CursorData | null;
  isAutocompleteEnabled: boolean;
  setCursorData: (cursorData: CursorData | null) => void;
  setIsAutocompleteEnabled: (enabled: boolean) => void;
  schemaCollapsed: boolean;
  setSchemaCollapsed: (collapsed: boolean) => void;
}

const SqlEditorContext = createContext<SqlEditorContextValue | null>(null);

export function SqlEditorProvider({
  children,
  datasourceId,
  sql,
  initialSchemaCollapsed = false,
}: {
  children: ReactNode;
  datasourceId: string;
  sql: string;
  initialSchemaCollapsed?: boolean;
}) {
  const [localSql, setLocalSql] = useState(sql);
  const [schemaCollapsed, setSchemaCollapsed] = useState(
    initialSchemaCollapsed,
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

  const value = useMemo(
    () => ({
      localSql,
      setLocalSql,
      autoCompletions,
      cursorData,
      isAutocompleteEnabled,
      setCursorData,
      setIsAutocompleteEnabled,
      schemaCollapsed,
      setSchemaCollapsed,
    }),
    [
      autoCompletions,
      cursorData,
      isAutocompleteEnabled,
      localSql,
      schemaCollapsed,
      setCursorData,
      setIsAutocompleteEnabled,
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
