import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "@/../back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import React, { useState } from "react";
import Collapsible from "react-collapsible";
import { FaDatabase } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import DatasourceTableData from "./DatasourceTableData";
import LoadingOverlay from "./LoadingOverlay";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  informationSchema: InformationSchemaInterface;
};

export default function DatasourceSchema({
  datasource,
  informationSchema,
}: Props) {
  const { apiCall } = useAuth();
  const [
    currentTable,
    setCurrentTable,
  ] = useState<InformationSchemaTablesInterface | null>(null);
  const [loading, setLoading] = useState(false);
  if (!datasource || !informationSchema) {
    return <LoadingOverlay />;
  }

  return (
    <div className="d-flex flex-column">
      <div className="col-sm">
        <label className="font-weight-bold mb-1">
          <FaDatabase /> {datasource.name}
        </label>
        <div key="database" className="border rounded p-1">
          {informationSchema.databases.map((database) => {
            return (
              <>
                {database.schemas.map((schema) => {
                  return (
                    <Collapsible
                      key={database.database_name + schema.schema_name}
                      trigger={`${database.database_name}.${schema.schema_name}`}
                    >
                      {schema.tables.map((table) => {
                        return (
                          <div
                            className="pl-3"
                            role="button"
                            key={
                              database.database_name +
                              schema.schema_name +
                              table.table_name
                            }
                            onClick={async () => {
                              try {
                                setLoading(true);
                                setCurrentTable(null);
                                const res = await apiCall<{
                                  status: number;
                                  table?: InformationSchemaTablesInterface;
                                }>(
                                  `/database/${database.database_name}/schema/${schema.schema_name}/table/${table.table_name}`,
                                  {
                                    method: "GET",
                                  }
                                );
                                setCurrentTable(res.table);
                                setLoading(false);
                              } catch (e) {
                                console.log("e", e);
                              }
                            }}
                          >
                            {table.table_name}
                          </div>
                        );
                      })}
                    </Collapsible>
                  );
                })}
              </>
            );
          })}
        </div>
      </div>
      <DatasourceTableData table={currentTable} loading={loading} />
    </div>
  );
}
