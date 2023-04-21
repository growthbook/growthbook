import { useState } from "react";
import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "@/../back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import useApi from "./useApi";

export default function useSchemaFormOptions(
  datasource: DataSourceInterfaceWithParams
) {
  const [tableId, setTableId] = useState("");

  const tableOptions: {
    schemaName: string;
    options: { label: string; value: string; queryValue: string }[];
  }[] = [];
  const supportsInformationSchema =
    datasource?.properties?.supportsInformationSchema;

  const { data } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(
    supportsInformationSchema && datasource?.id
      ? `/datasource/${datasource.id}/schema`
      : null
  );

  if (data?.informationSchema?.databases.length) {
    data.informationSchema.databases.forEach((database) => {
      database?.schemas?.forEach((schema) => {
        const option = { schemaName: schema.schemaName, options: [] };
        schema?.tables?.forEach((table) => {
          option.options.push({
            label: table.tableName,
            value: table.id,
            queryValue: table.path,
          });
        });
        tableOptions.push(option);
      });
    });
  }

  const columnOptions: {
    schemaName: string;
    options: { label: string; value: string; queryValue: string }[];
  }[] = [];

  const { data: columnData } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(
    tableId && datasource?.id
      ? `/datasource/${datasource.id}/schema/table/${tableId}`
      : null
  );

  if (columnData?.table?.columns.length) {
    const option = { schemaName: columnData.table.tableSchema, options: [] };
    columnData.table.columns.forEach((column) => {
      option.options.push({
        label: column.columnName,
        value: column.columnName,
        queryValue: column.columnName,
      });
    });
    columnOptions.push(option);
  }

  return {
    setTableId,
    tableOptions,
    columnOptions,
  };
}
