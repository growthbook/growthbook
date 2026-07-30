import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  isManagedWarehouseUnavailable,
  MANAGED_WAREHOUSE_EVENTS_TABLE,
} from "shared/util";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { InformationSchemaTablesInterface } from "shared/types/integrations";
import { JSONColumnFields } from "shared/types/fact-table";
import { useEffect, useMemo, useState } from "react";
import { FaRedo, FaTable } from "react-icons/fa";
import { Box } from "@radix-ui/themes";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import useFullFactTable from "@/hooks/useFullFactTable";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import { AreaWithHeader } from "./SqlExplorerModal";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  datasourceId: string;
  tableId: string;
  setError: (error: string | null) => void;
  canRunQueries: boolean;
};

export default function DatasourceSchema({
  datasource,
  tableId,
  datasourceId,
  setError,
  canRunQueries,
}: Props) {
  const managedWarehousePending = isManagedWarehouseUnavailable(datasource);

  const { data, mutate } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`, {
    shouldRun: () => !!tableId && !managedWarehousePending,
  });

  const table = data?.table;
  const [fetching, setFetching] = useState(false);
  const [retryCount, setRetryCount] = useState(1);
  const [dateLastUpdated, setDateLastUpdated] = useState<Date | null>(null);
  const [columnFilter, setColumnFilter] = useState("");
  const { apiCall } = useAuth();
  // For a managed warehouse, the raw information schema reports `attributes` /
  // `properties` as single JSON columns. Pull the detected sub-fields from the
  // built-in `ch_events` fact table so they show as `attributes.<field>` rows,
  // matching the fact-table column list. jsonFields is slimmed out of the
  // definitions copy, so fetch the full fact table by id.
  const isManagedWarehouseEventsTable =
    datasource.type === "growthbook_clickhouse" &&
    table?.tableName === MANAGED_WAREHOUSE_EVENTS_TABLE;
  const { factTable: eventsFactTable } = useFullFactTable(
    isManagedWarehouseEventsTable
      ? MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID
      : null,
  );
  const jsonFieldsByColumn = useMemo<Record<string, JSONColumnFields>>(() => {
    if (!eventsFactTable || eventsFactTable.datasource !== datasourceId) {
      return {};
    }
    const map: Record<string, JSONColumnFields> = {};
    for (const col of eventsFactTable.columns) {
      if (col.datatype === "json" && !col.deleted && col.jsonFields) {
        map[col.column] = col.jsonFields;
      }
    }
    return map;
  }, [eventsFactTable, datasourceId]);

  // Information-schema columns with JSON sub-fields expanded into their own
  // pseudo-column rows (`attributes.<field>`).
  const expandedColumns = useMemo(() => {
    const out: { columnName: string; dataType: string; jsonField?: boolean }[] =
      [];
    for (const column of table?.columns || []) {
      out.push({ columnName: column.columnName, dataType: column.dataType });
      const jsonFields = jsonFieldsByColumn[column.columnName];
      if (jsonFields) {
        for (const [field, data] of Object.entries(jsonFields)) {
          out.push({
            columnName: `${column.columnName}.${field}`,
            dataType: data.datatype,
            jsonField: true,
          });
        }
      }
    }
    return out;
  }, [table?.columns, jsonFieldsByColumn]);

  const filteredColumns = useMemo(() => {
    if (!columnFilter) return expandedColumns;

    return expandedColumns.filter((column) => {
      return column.columnName
        .toLowerCase()
        .includes(columnFilter.trim().toLowerCase());
    });
  }, [columnFilter, expandedColumns]);

  useEffect(() => {
    if (fetching) {
      if (
        retryCount > 1 &&
        retryCount < 8 &&
        // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
        dateLastUpdated < table?.dateUpdated
      ) {
        setFetching(false);
        setRetryCount(1);
      } else if (retryCount > 8) {
        setFetching(false);
        setError(
          "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes.",
        );
        setRetryCount(1);
      } else {
        const timer = setTimeout(() => {
          mutate();
          setRetryCount(retryCount * 2);
        }, retryCount * 1000);
        return () => {
          clearTimeout(timer);
        };
      }
    }
  }, [dateLastUpdated, fetching, mutate, retryCount, setError, table]);

  useEffect(() => {
    setFetching(false);
    setColumnFilter("");
  }, [tableId]);

  if (managedWarehousePending) {
    return (
      <div
        className="p-2"
        style={{
          height: "50%",
          flex: 1,
        }}
      >
        <ManagedWarehouseNoEventsCallout />
      </div>
    );
  }

  if (tableId && !table)
    return (
      <div
        className="p-2"
        style={{
          height: "50%",
          flex: 1,
        }}
      >
        <LoadingSpinner />
        <span className="pl-2">Loading Table Data...</span>
      </div>
    );

  if (!table) return null;
  return (
    <AreaWithHeader
      backgroundColor="var(--color-surface)"
      header={
        <>
          <div className="d-flex justify-content-between px-2">
            <label className="font-weight-bold mb-1 d-flex align-items-center">
              <FaTable className="mr-2" />
              {table ? (
                <span
                  className="px-1"
                  style={{
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                  }}
                >
                  {datasource.type === "growthbook_clickhouse"
                    ? table.tableName
                    : `${table.tableSchema}.${table.tableName}`}
                </span>
              ) : (
                <LoadingSpinner />
              )}
            </label>
            {table && (
              <div className="d-flex align-items-center pl-5">
                <label className="ml-3 mb-0">
                  <Tooltip
                    body={
                      <div>
                        <div>
                          {`Last Updated: ${new Date(
                            table.dateUpdated,
                          ).toLocaleString()}`}
                        </div>
                        {!canRunQueries ? (
                          <Callout status="warning" mt="2">
                            You do not have permission to refresh this
                            information schema.
                          </Callout>
                        ) : null}
                      </div>
                    }
                    tipPosition="top"
                  >
                    <button
                      className="btn btn-link p-0 text-secondary"
                      disabled={fetching}
                      onClick={async (e) => {
                        e.preventDefault();
                        setDateLastUpdated(table.dateUpdated);
                        setError(null);
                        try {
                          await apiCall<{
                            status: number;
                            table?: InformationSchemaTablesInterface;
                          }>(
                            `/datasource/${datasourceId}/schema/table/${table.id}`,
                            {
                              method: "PUT",
                            },
                          );
                          setFetching(true);
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      {fetching ? <LoadingSpinner /> : <FaRedo />}
                    </button>
                  </Tooltip>
                </label>
              </div>
            )}
          </div>
          <Box mt="1">
            <Field
              size="legacy"
              type="search"
              value={columnFilter}
              onChange={(e) => setColumnFilter(e.target.value)}
              placeholder="Filter columns..."
              autoFocus
            />
          </Box>
        </>
      }
    >
      <div style={{ overflow: "auto", height: "100%" }}>
        <table className="table table-sm">
          <tbody>
            {filteredColumns.length > 0 ? (
              <>
                {filteredColumns?.map((column) => {
                  return (
                    <tr key={`${table.tableName}:${column.columnName}`}>
                      <td className="pl-3">
                        {column.jsonField ? (
                          <span
                            className="text-muted"
                            style={{ paddingLeft: 16 }}
                          >
                            {column.columnName}
                          </span>
                        ) : (
                          column.columnName
                        )}
                      </td>
                      <td className="pr-3 text-right text-muted">
                        {column.dataType}
                      </td>
                    </tr>
                  );
                })}
              </>
            ) : (
              <tr>
                <td colSpan={2} className="text-muted p-2">
                  No columns found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AreaWithHeader>
  );
}
