import { InformationSchemaTablesInterface } from "@/../back-end/src/types/Integration";
import React from "react";
import { FaDatabase } from "react-icons/fa";
import LoadingSpinner from "./LoadingSpinner";

type Props = {
  table?: InformationSchemaTablesInterface;
  loading: boolean;
};

export default function DatasourceSchema({ table, loading }: Props) {
  if (loading) return <LoadingSpinner />;

  if (!table) return null;

  return (
    <div className="col-sm">
      <label className="font-weight-bold mb-1">
        <FaDatabase /> {table.table_name}
      </label>
      <div key="database" className="border rounded p-1">
        {table.columns.map((column) => {
          return (
            <p key={table.table_name + column.column_name}>
              {column.column_name} - {column.data_type}
            </p>
          );
        })}
      </div>
    </div>
  );
}
