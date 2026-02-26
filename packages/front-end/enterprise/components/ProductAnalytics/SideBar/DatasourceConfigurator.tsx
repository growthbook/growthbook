import React, { useCallback, useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FaRedo } from "react-icons/fa";
import {
  InformationSchemaInterfaceWithPaths,
  InformationSchemaTablesInterface,
} from "shared/types/integrations";
import {
  DatabaseValue,
  ProductAnalyticsDataset,
} from "shared/src/validators/product-analytics";
import { PiCheck } from "react-icons/pi";
import SelectField from "@/components/Forms/SelectField";
import {
  createEmptyValue,
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
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { setDraftExploreState, draftExploreState } = useExplorerContext();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const [tableData, setTableData] =
    useState<InformationSchemaTablesInterface | null>(null);
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState(1);

  const databaseDataset = dataset?.type === "data_source" ? dataset : null;
  const datasourceId = draftExploreState?.datasource;
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
    informationSchema.status === "COMPLETE";

  return (
    <Flex direction="column" gap="2">
      {informationSchema?.error ? (
        <Callout status="error" mt="2">
          <Flex direction="column" gap="2">
            <Text weight="medium">
              We&apos;re unable to identify tables for this Data Source.
            </Text>
            <Text>Reason: {informationSchema?.error?.message}</Text>
            <Tooltip
              body="You do not have permission to retry generating an information schema for this datasource."
              shouldDisplay={!canRunQueries}
            >
              <Button
                disabled={!canRunQueries}
                variant="soft"
                color="red"
                onClick={() => refreshOrCreateInfoSchema("PUT")}
              >
                Retry
              </Button>
            </Tooltip>
          </Flex>
        </Callout>
      ) : datasourceId && !informationSchema && !fetching ? (
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
      ) : (
        <>
          <Flex justify="between" align="center" mt="2">
            <Text weight="medium" mt="2">
              Table
            </Text>

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
            value={databaseDataset?.table || ""}
            onChange={(value) => {
              const selectedTable = tableOptions.find(
                (t) => t.tableId === value,
              );
              setDraftExploreState((prev) => {
                const prevDataset =
                  prev.dataset?.type === "data_source" ? prev.dataset : null;
                return {
                  ...prev,
                  dataset: {
                    ...(prevDataset ?? { type: "data_source" as const }),
                    table: value,
                    path: selectedTable?.tablePath || "",
                    columnTypes: {},
                    timestampColumn: "",
                    values: prevDataset?.values?.length
                      ? prevDataset.values
                      : [createEmptyValue("data_source") as DatabaseValue],
                  },
                };
              });
            }}
            options={tableOptions.map((t) => ({
              label: t.tableName,
              value: t.tableId,
            }))}
            placeholder="Select table..."
            forceUndefinedValueToNull
          />
          {tableData && (
            <Flex direction="column" gap="2" mt="2">
              <Text weight="medium">Timestamp Column</Text>
              <Flex justify="between" align="center">
                <Text color="text-low">
                  {databaseDataset?.timestampColumn ||
                    "Select timestamp column..."}
                </Text>
                <DropdownMenu
                  open={dropdownOpen}
                  onOpenChange={setDropdownOpen}
                  trigger={
                    <Button size="xs" variant="ghost">
                      <Text weight="semibold" size="small">
                        {!databaseDataset?.timestampColumn
                          ? "select"
                          : "change"}
                      </Text>
                    </Button>
                  }
                >
                  {tableData.columns.map((column) => (
                    <DropdownMenuItem
                      key={column.columnName}
                      onClick={() => {
                        setDraftExploreState((prev) => ({
                          ...prev,
                          dataset: {
                            ...prev.dataset,
                            timestampColumn: column.columnName,
                          },
                        }));
                      }}
                    >
                      <Flex align="center" justify="between" gap="2">
                        <Flex align="center" width="20px">
                          {databaseDataset?.timestampColumn ===
                          column.columnName ? (
                            <PiCheck size={16} />
                          ) : null}
                        </Flex>
                        {column.columnName}
                      </Flex>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              </Flex>
            </Flex>
          )}
        </>
      )}
    </Flex>
  );
}
