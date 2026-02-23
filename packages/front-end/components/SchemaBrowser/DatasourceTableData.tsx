import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { InformationSchemaTablesInterface } from "shared/types/integrations";
import React, { useEffect, useState } from "react";
import { FaRedo, FaTable } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
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
  const { data, mutate } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`);

  const table = data?.table;
  const [fetching, setFetching] = useState(false);
  const [retryCount, setRetryCount] = useState(1);
  const [dateLastUpdated, setDateLastUpdated] = useState<Date | null>(null);
  const { apiCall } = useAuth();

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
  }, [tableId]);

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
            <label className="pl-5">
              <Tooltip
                body={
                  <div>
                    <div>
                      {`Last Updated: ${new Date(
                        table.dateUpdated,
                      ).toLocaleString()}`}
                    </div>
                    {!canRunQueries ? (
                      <div className="alert alert-warning mt-2">
                        You do not have permission to refresh this information
                        schema.
                      </div>
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
          )}
        </div>
      }
    >
      <div style={{ overflow: "auto", height: "100%" }}>
        <table className="table table-sm">
          <tbody>
            {table?.columns.map((column) => {
              return (
                <tr key={table.tableName + column.columnName}>
                  <td className="pl-3">{column.columnName}</td>
                  <td className="pr-3 text-right text-muted">
                    {column.dataType}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AreaWithHeader>
  );
}
