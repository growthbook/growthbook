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
      <div
        className="border rounded"
        style={{ maxHeight: "250px", overflowY: "scroll" }}
      >
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
    </div>
  );
}
