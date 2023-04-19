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

  const tableOptions: { label: string; value: string }[] = [];
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
        schema?.tables?.forEach((table) => {
          tableOptions.push({ label: table.tableName, value: table.id });
        });
      });
    });
  }

  const columnOptions: { label: string; value: string }[] = [];

  const { data: columnData } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(
    tableId && datasource?.id
      ? `/datasource/${datasource.id}/schema/table/${tableId}`
      : null
  );

  if (columnData?.table?.columns.length) {
    columnData.table.columns.forEach((column) => {
      columnOptions.push({
        label: column.columnName,
        value: column.columnName,
      });
    });
  }

  return {
    setTableId,
    tableOptions,
    columnOptions,
  };
}
