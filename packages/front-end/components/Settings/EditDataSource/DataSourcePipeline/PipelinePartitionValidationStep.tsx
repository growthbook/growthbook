import { useCallback, useMemo } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function PipelinePartitionValidationStep({
  dataSource,
}: {
  dataSource: DataSourceInterfaceWithParams;
}) {
  const { apiCall } = useAuth();
  const { factTables } = useDefinitions();

  const dataSourceExposureQueries = useMemo(
    () => dataSource.settings?.queries?.exposure || [],
    [dataSource.settings?.queries?.exposure],
  );
  const dataSourceFactTables = factTables.filter(
    (t) => t.datasource === dataSource.id,
  );

  const validateByIds = useCallback(
    async (ids: string[]): Promise<Record<string, unknown>> => {
      if (!ids.length) return {};
      try {
        const res = await apiCall<{
          status: number;
          queryResults: {
            id: string;
            columnsFound?: string[];
            missingColumns?: string[];
            error?: string;
          }[];
        }>(`/datasource/${dataSource.id}/pipeline/validate-queries`, {
          method: "POST",
          body: JSON.stringify({ queryIds: ids }),
        });
        const map: Record<string, unknown> = {};
        (res.queryResults || []).forEach((r) => {
          map[r.id] = {
            id: r.id,
            missingColumns: r.missingColumns || [],
            error: r.error,
            status: "done",
          };
        });
        return map;
      } catch (e) {
        const map: Record<string, unknown> = {};
        ids.forEach((id) => {
          map[id] = {
            id,
            missingColumns: [],
            error: "message" in e ? e.message : String(e),
            status: "done",
          };
        });
        return map;
      }
    },
    [apiCall, dataSource.id],
  );

  return <div>PipelinePartitionValidationStep</div>;
}
