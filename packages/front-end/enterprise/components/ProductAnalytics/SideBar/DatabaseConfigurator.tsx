import React, { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  InformationSchemaInterfaceWithPaths,
  InformationSchemaTablesInterface,
} from "shared/types/integrations";
import { ProductAnalyticsDataset } from "shared/src/validators/product-analytics";
import SelectField from "@/components/Forms/SelectField";
import { mapDatabaseTypeToEnum } from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";

type TableOption = {
  tableName: string;
  tableId: string;
  tablePath: string;
};

export default function DatabaseConfigurator({
  dataset,
}: {
  dataset: ProductAnalyticsDataset;
}) {
  const { datasources } = useDefinitions();
  const { setDraftExploreState } = useExplorerContext();
  const [tableData, setTableData] =
    useState<InformationSchemaTablesInterface | null>(null);
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);

  const databaseDataset = dataset?.type === "database" ? dataset : null;
  const datasource = databaseDataset?.datasource;
  const tableId = databaseDataset?.table;

  const { data: informationSchemaResponse } = useApi<{
    informationSchema: InformationSchemaInterfaceWithPaths;
  }>(`/datasource/${datasource}/schema`, { shouldRun: () => !!datasource });

  const { data: tableDataResponse } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasource}/schema/table/${tableId}`, {
    shouldRun: () => !!tableId && !!datasource,
  });

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
    //TODO: Need to support a table not having an info schema, or that info schema being stale
  }, [informationSchemaResponse]);

  useEffect(() => {
    if (tableDataResponse && tableDataResponse.table) {
      setTableData(tableDataResponse.table);

      // Build columnTypes - normalize column data types to our enum
      const columnTypes: Record<
        string,
        "string" | "number" | "date" | "boolean" | "other"
      > = {};
      tableDataResponse.table.columns.forEach((column) => {
        columnTypes[column.columnName] = mapDatabaseTypeToEnum(column.dataType);
      });

      const timestampColumn = Object.keys(columnTypes).find(
        (key) => columnTypes[key] === "date",
      );

      setDraftExploreState((prev) => ({
        ...prev,
        dataset: {
          ...prev.dataset,
          columnTypes,
          timestampColumn: timestampColumn || "",
        },
      }));
      //MKTODO: Need to support a table not having an info schema, or that info schema being stale, or just not having columns
    }
  }, [tableDataResponse, setDraftExploreState]);

  return (
    <Flex direction="column">
      <SelectField
        label="Data source"
        value={datasource || ""}
        onChange={(datasource) =>
          setDraftExploreState((prev) => ({
            ...prev,
            dataset: { ...dataset, datasource },
          }))
        }
        options={datasources.map((d) => ({
          label: d.name,
          value: d.id,
        }))}
        placeholder="Select data source..."
        forceUndefinedValueToNull
      />
      {tableOptions.length > 0 && (
        <SelectField
          label="Table"
          value={databaseDataset?.table || ""}
          onChange={(value) => {
            const selectedTable = tableOptions.find((t) => t.tableId === value);
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
      )}
      <SelectField
        label="Timestamp column"
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
    </Flex>
  );
}
