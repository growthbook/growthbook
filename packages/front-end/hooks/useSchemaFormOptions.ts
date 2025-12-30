import { useState } from "react";
import {
  InformationSchemaInterfaceWithPaths,
  InformationSchemaTablesInterface,
} from "shared/types/integrations";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { GroupedValue, SingleValue } from "@/components/Forms/SelectField";
import useApi from "./useApi";

export default function useSchemaFormOptions(
  datasource: DataSourceInterfaceWithParams,
) {
  const [tableId, setTableId] = useState("");

  const supportsInformationSchema =
    datasource?.properties?.supportsInformationSchema;

  const { data } = useApi<{
    informationSchema: InformationSchemaInterfaceWithPaths;
  }>(`/datasource/${datasource?.id}/schema`, {
    shouldRun: () => !!supportsInformationSchema && !!datasource?.id,
  });

  const tableGroups: Map<string, GroupedValue> = new Map();
  const tableIdMapping: Map<string, string> = new Map();
  if (data?.informationSchema?.databases.length) {
    data.informationSchema?.databases?.forEach((database) => {
      database?.schemas?.forEach((schema) => {
        let group = tableGroups.get(schema.schemaName);
        if (!group) {
          group = {
            label: schema.schemaName,
            options: [],
          };
          tableGroups.set(schema.schemaName, group);
        }

        schema?.tables?.forEach((table) => {
          group?.options?.push({
            label: table.tableName,
            value: table.path,
          });
          tableIdMapping.set(table.path, table.id);
        });
      });
    });
  }

  const { data: columnData } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasource?.id}/schema/table/${tableId}`, {
    shouldRun: () => !!tableId && !!datasource?.id,
  });

  const columnOptions: SingleValue[] = [];
  if (columnData?.table?.columns.length) {
    columnData.table.columns.forEach((column) => {
      columnOptions.push({
        label: column.columnName,
        value: column.columnName,
      });
    });
  }

  return {
    // The table path is passed in, need to look up the id from this
    setTableId: (value: string) => {
      setTableId(tableIdMapping.get(value) || "");
    },
    tableOptions: Array.from(tableGroups.values()),
    columnOptions,
  };
}
