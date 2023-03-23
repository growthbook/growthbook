import { InformationSchemaTablesInterface } from "@/../back-end/src/types/Integration";
import React from "react";
import { FaTable } from "react-icons/fa";
import LoadingSpinner from "../LoadingSpinner";

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
            <th className="pl-3">Column</th>
            <th className="pr-3 text-right">Data Type</th>
          </tr>
        </thead>
        <tbody>
          {table?.columns.map((column) => {
            return (
              <tr key={table.tableName + column.columnName}>
                <td className="pl-3">{column.columnName}</td>
                <td className="pr-3 text-right">{column.dataType}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
