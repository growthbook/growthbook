import React, { useCallback, useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FaRedo } from "react-icons/fa";
import {
  InformationSchemaInterfaceWithPaths,
  InformationSchemaTablesInterface,
} from "shared/types/integrations";
import { ProductAnalyticsDataset } from "shared/src/validators/product-analytics";
import SelectField from "@/components/Forms/SelectField";
import {
  getInferredTimestampColumn,
  mapDatabaseTypeToEnum,
} from "@/enterprise/components/ProductAnalytics/util";
import Text from "@/ui/Text";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import BuildTablesCard from "./BuildTablesCard";
import PendingTablesCard from "./PendingTablesCard";

type TableOption = {
  tableName: string;
  tableId: string;
  tablePath: string;
};

export default function DatasourceConfigurator({
  dataset,
}: {
  dataset: ProductAnalyticsDataset;
}) {
  const { datasources } = useDefinitions();
  const { setDraftExploreState } = useExplorerContext();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const [tableData, setTableData] =
    useState<InformationSchemaTablesInterface | null>(null);
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState(1);

  const databaseDataset = dataset?.type === "data_source" ? dataset : null;
  const datasourceId = databaseDataset?.datasource;
  const tableId = databaseDataset?.table;

  const datasourceObj = datasources.find((d) => d.id === datasourceId);
  const canRunQueries = datasourceObj
    ? permissionsUtil.canRunSchemaQueries(datasourceObj)
    : false;

  const { data: informationSchemaResponse, mutate } = useApi<{
    informationSchema: InformationSchemaInterfaceWithPaths;
  }>(`/datasource/${datasourceId}/schema`, {
    shouldRun: () => !!datasourceId,
  });

  const { data: tableDataResponse } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`, {
    shouldRun: () => !!tableId && !!datasourceId,
  });

  const informationSchema = informationSchemaResponse?.informationSchema;

  const refreshOrCreateInfoSchema = useCallback(
    async (type: "PUT" | "POST") => {
      setError(null);
      try {
        await apiCall<{
          status: number;
          message?: string;
        }>(`/datasource/${datasourceId}/schema`, {
          method: type,
          body: JSON.stringify({
            informationSchemaId: informationSchema?.id,
          }),
        });
        setFetching(true);
      } catch (e) {
        setError(e.message);
      }
    },
    [apiCall, datasourceId, informationSchema?.id],
  );

  useEffect(() => {
    if (
      informationSchemaResponse &&
      informationSchemaResponse.informationSchema
    ) {
      const newTableOptions: TableOption[] = [];
      // Loop through each database and schema to build all table options
      informationSchemaResponse.informationSchema.databases.forEach(
        (database) => {
          database.schemas.forEach((schema) => {
            schema.tables.forEach((table) => {
              newTableOptions.push({
                tableName: table.tableName,
                tableId: table.id,
                tablePath: table.path,
              });
            });
          });
        },
      );
      setTableOptions(newTableOptions);
    }
  }, [informationSchemaResponse]);

  useEffect(() => {
    if (tableDataResponse && tableDataResponse.table) {
      setTableData(tableDataResponse.table);

      const columnTypes: Record<
        string,
        "string" | "number" | "date" | "boolean" | "other"
      > = {};
      tableDataResponse.table.columns.forEach((column) => {
        // Map database data types to our enums
        columnTypes[column.columnName] = mapDatabaseTypeToEnum(column.dataType);
      });

      const timestampColumn = getInferredTimestampColumn(columnTypes);

      setDraftExploreState((prev) => ({
        ...prev,
        dataset: {
          ...prev.dataset,
          columnTypes,
          timestampColumn: timestampColumn || "",
        },
      }));
    }
  }, [tableDataResponse, setDraftExploreState]);

  // Polling effect for information schema generation
  useEffect(() => {
    if (fetching) {
      if (
        retryCount > 1 &&
        retryCount < 8 &&
        informationSchema?.status === "COMPLETE"
      ) {
        setFetching(false);
        setRetryCount(1);
      } else if (retryCount > 8) {
        setFetching(false);
        setError(
          "This is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes.",
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
  }, [fetching, mutate, retryCount, informationSchema]);

  const showRefreshButton =
    datasourceId &&
    informationSchema &&
    !informationSchema.error &&
    informationSchema.status === "COMPLETE";

  return (
    <Flex direction="column" gap="2">
      <>
        <Flex justify="between" align="center" mt="2">
          <Text weight="medium">Data Source</Text>
          {showRefreshButton && (
            <Tooltip
              body={
                <div>
                  <div>
                    {`Last Updated: ${new Date(
                      informationSchema.dateUpdated,
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
                type="button"
                className="btn btn-link p-0 text-secondary"
                disabled={fetching || !canRunQueries}
                onClick={() => refreshOrCreateInfoSchema("PUT")}
              >
                {fetching ? <LoadingSpinner /> : <FaRedo />}
              </button>
            </Tooltip>
          )}
        </Flex>
        <SelectField
          value={datasourceId || ""}
          onChange={(datasource) =>
            setDraftExploreState((prev) => ({
              ...prev,
              dataset: {
                ...dataset,
                datasource,
                table: "",
                path: "",
                timestampColumn: "",
              },
            }))
          }
          options={datasources.map((d) => ({
            label: d.name,
            value: d.id,
          }))}
          placeholder="Select data source..."
          forceUndefinedValueToNull
        />
      </>
      {datasourceId && !informationSchema && !fetching ? (
        <BuildTablesCard
          refreshOrCreateInfoSchema={refreshOrCreateInfoSchema}
          canRunQueries={canRunQueries}
          error={error}
        />
      ) : (informationSchema?.status === "PENDING" || fetching) &&
        datasourceId ? (
        <PendingTablesCard mutate={mutate} />
      ) : error ? (
        <Callout status="error" mt="2">
          <Flex direction="column" gap="2">
            <span>{error}</span>
            <Tooltip
              body="You do not have permission to retry generating an information schema for this datasource."
              shouldDisplay={!canRunQueries}
            >
              <button
                type="button"
                disabled={!canRunQueries}
                className="btn btn-link"
                onClick={() => refreshOrCreateInfoSchema("PUT")}
              >
                Retry
              </button>
            </Tooltip>
          </Flex>
        </Callout>
      ) : tableOptions.length > 0 ? (
        <>
          <Text weight="medium" mt="2">
            Table
          </Text>
          <SelectField
            value={databaseDataset?.table || ""}
            onChange={(value) => {
              const selectedTable = tableOptions.find(
                (t) => t.tableId === value,
              );
              setDraftExploreState((prev) => ({
                ...prev,
                dataset: {
                  ...prev.dataset,
                  table: value,
                  path: selectedTable?.tablePath || "",
                },
              }));
            }}
            options={tableOptions.map((t) => ({
              label: t.tableName,
              value: t.tableId,
            }))}
            placeholder="Select table..."
            forceUndefinedValueToNull
          />
          {tableData && (
            <>
              <Text weight="medium" mt="2">
                Timestamp column
              </Text>
              <SelectField
                disabled={!tableData}
                value={databaseDataset?.timestampColumn || ""}
                onChange={(timestampColumn) =>
                  setDraftExploreState((prev) => ({
                    ...prev,
                    dataset: { ...dataset, timestampColumn },
                  }))
                }
                options={
                  tableData?.columns.map((c) => ({
                    label: c.columnName,
                    value: c.columnName,
                  })) || []
                }
                placeholder="Select timestamp column..."
                forceUndefinedValueToNull
              />
            </>
          )}
        </>
      ) : datasourceId && informationSchema ? (
        <Callout status="error" mt="2">
          No tables found for this data source. Please select a different data
          source.
        </Callout>
      ) : null}
    </Flex>
  );
}
