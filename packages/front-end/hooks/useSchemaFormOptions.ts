import { useState } from "react";
import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "@/../back-end/src/types/Integration";
import useApi from "./useApi";

export default function useSchemaFormOptions(datasourceId: string) {
  const [tableId, setTableId] = useState("");

  const tableOptions: { label: string; value: string }[] = [];

  const { data: TableData } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(`/datasource/${datasourceId}/schema`);

  if (TableData?.informationSchema?.databases.length) {
    TableData.informationSchema.databases.forEach((database) => {
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
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`);

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
