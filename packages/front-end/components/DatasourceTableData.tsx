import { InformationSchemaTablesInterface } from "@/../back-end/src/types/Integration";
import React from "react";
import { FaTable } from "react-icons/fa";
import LoadingSpinner from "./LoadingSpinner";

type Props = {
  table?: InformationSchemaTablesInterface;
  loading: boolean;
};

export default function DatasourceSchema({ table, loading }: Props) {
  if (!loading && !table) return null;
  return (
    <div className="pt-2">
      <label className="font-weight-bold">
        <div>
          <FaTable />{" "}
          {table ? (
            `${table.tableSchema}.${table.tableName}`
          ) : (
            <LoadingSpinner />
          )}
        </div>
      </label>
      <table
        className="table table-sm border w-100"
        style={{ maxHeight: "200px", overflowY: "scroll" }}
      >
        <thead>
          <tr>
            <th>Column</th>
            <th>Data Type</th>
          </tr>
        </thead>
        <tbody>
          {table?.columns.map((column) => {
            return (
              <tr key={table.tableName + column.columnName}>
                <td>{column.columnName}</td>
                <td>{column.dataType}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
