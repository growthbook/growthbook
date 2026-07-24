import { useEffect, useState } from "react";
import { InformationSchemaInterfaceWithPaths } from "shared/types/integrations";
import { isManagedWarehouseUnavailable } from "shared/util";
import { AceCompletion } from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getAutoCompletions } from "@/services/sqlAutoComplete";

const AUTOCOMPLETE_STORAGE_KEY = "sql-editor-autocomplete-enabled";

export default function useSqlAutocomplete({
  datasourceId,
  source,
  eventName,
  skipManagedWarehouseUnavailable = false,
}: {
  datasourceId: string;
  source: "EditSqlModal" | "SqlExplorer";
  eventName?: string;
  skipManagedWarehouseUnavailable?: boolean;
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const [cursorData, setCursorData] = useState<CursorData | null>(null);
  const [autoCompletions, setAutoCompletions] = useState<AceCompletion[]>([]);
  const [informationSchema, setInformationSchema] = useState<
    InformationSchemaInterfaceWithPaths | undefined
  >();
  const [isAutocompleteEnabled, setIsAutocompleteEnabled] = useLocalStorage(
    AUTOCOMPLETE_STORAGE_KEY,
    true,
  );
  const datasource = getDatasourceById(datasourceId);

  useEffect(() => {
    const fetchCompletions = async () => {
      if (!isAutocompleteEnabled) {
        setAutoCompletions([]);
        return;
      }

      try {
        const completions = await getAutoCompletions(
          cursorData,
          informationSchema,
          datasource?.type,
          apiCall,
          source,
          eventName,
        );
        setAutoCompletions(completions);
      } catch (error) {
        console.error("Failed to fetch autocompletions:", error);
        setAutoCompletions([]);
      }
    };

    const timeoutId = setTimeout(fetchCompletions, 200);
    return () => clearTimeout(timeoutId);
  }, [
    apiCall,
    cursorData,
    datasource?.type,
    eventName,
    informationSchema,
    isAutocompleteEnabled,
    source,
  ]);

  useEffect(() => {
    const fetchSchema = async () => {
      if (!isAutocompleteEnabled) {
        setInformationSchema(undefined);
        return;
      }
      if (
        skipManagedWarehouseUnavailable &&
        datasource &&
        isManagedWarehouseUnavailable(datasource)
      ) {
        setInformationSchema(undefined);
        return;
      }

      try {
        const response = await apiCall<{
          informationSchema: InformationSchemaInterfaceWithPaths;
        }>(`/datasource/${datasourceId}/schema`);
        setInformationSchema(response.informationSchema);
      } catch (error) {
        console.error("Failed to fetch schema:", error);
        setInformationSchema(undefined);
      }
    };

    fetchSchema();
  }, [
    apiCall,
    datasource,
    datasourceId,
    isAutocompleteEnabled,
    skipManagedWarehouseUnavailable,
  ]);

  return {
    autoCompletions,
    cursorData,
    informationSchema,
    isAutocompleteEnabled,
    setCursorData,
    setIsAutocompleteEnabled,
  };
}
