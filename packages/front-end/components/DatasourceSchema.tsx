import {
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "@/../back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import React, { useEffect, useState } from "react";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight, FaDatabase, FaTable } from "react-icons/fa";
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

  useEffect(() => {
    setCurrentTable(null);
  }, [datasource]);

  if (!datasource || !informationSchema) {
    return <LoadingOverlay />;
  }

  return (
    <div className="d-flex flex-column">
      <div>
        <label className="font-weight-bold mb-1">
          <FaDatabase /> {datasource.name}
        </label>
        <div
          key="database"
          className="border rounded p-1"
          style={{
            height: "210px",
            overflowY: "scroll",
          }}
        >
          {informationSchema.databases.map((database) => {
            return (
              <>
                {database.schemas.map((schema) => {
                  return (
                    <div key={schema.schema_name} className="pb-2">
                      <Collapsible
                        className="pb-1"
                        key={database.database_name + schema.schema_name}
                        trigger={
                          <>
                            <FaAngleRight />
                            {`${database.database_name}.${schema.schema_name}`}
                          </>
                        }
                        triggerWhenOpen={
                          <>
                            <FaAngleDown />
                            {`${database.database_name}.${schema.schema_name}`}
                          </>
                        }
                        triggerStyle={{
                          fontWeight: "bold",
                        }}
                        transitionTime={100}
                      >
                        {schema.tables.map((table) => {
                          return (
                            <div
                              className="pl-3 pb-1"
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
                              <FaTable /> {table.table_name}
                            </div>
                          );
                        })}
                      </Collapsible>
                    </div>
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
