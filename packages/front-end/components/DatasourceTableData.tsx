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
            `${table.table_schema}.${table.table_name}`
          ) : (
            <LoadingSpinner />
          )}
        </div>
      </label>
      <table className="table table-sm border w-100">
        <thead>
          <tr>
            <th>Column</th>
            <th>Data Type</th>
          </tr>
        </thead>
        <tbody>
          {table?.columns.map((column) => {
            return (
              <tr key={table.table_name + column.column_name}>
                <td>{column.column_name}</td>
                <td>{column.data_type}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
