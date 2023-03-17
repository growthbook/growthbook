import {
  InformationSchema,
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "@/../back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import React, { useEffect, useState } from "react";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight, FaTable } from "react-icons/fa";
import { cloneDeep } from "lodash";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import DatasourceTableData from "./DatasourceTableData";
import Field from "./Forms/Field";
import { CursorData } from "./Segments/SegmentForm";
import SchemaBrowserWrapper from "./SchemaBrowserWrapper";
import BuildInformationSchemaCard from "./BuildInformationSchemaCard";
import RetryInformationSchemaCard from "./RetryInformationSchemaCard";
import PendingInformationSchemaCard from "./PendingInformationSchemaCard";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  informationSchema: InformationSchemaInterface;
  mutate: () => void;
  cursorData: CursorData;
  updateSqlInput: (sql: string) => void;
};

export default function SchemaBrowser({
  datasource,
  informationSchema,
  mutate,
  updateSqlInput,
  cursorData,
}: Props) {
  const { apiCall } = useAuth();
  const [
    currentTable,
    setCurrentTable,
  ] = useState<InformationSchemaTablesInterface | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = cursorData?.row || 0;
  const column = cursorData?.column || 0;
  const inputArray = cursorData?.input || [];

  function pastePathIntoExistingQuery(
    existingQuery: string,
    index: number,
    pathToPaste: string
  ) {
    if (index === existingQuery.length - 1) return existingQuery + pathToPaste;
    return (
      existingQuery.substring(0, index) +
      pathToPaste +
      existingQuery.substring(index)
    );
  }

  const { items, searchInputProps } = useSearch({
    items: (informationSchema?.databases as InformationSchema[]) || [],
    // searchFields: ["schemas.tables.path"], //MKTODO: Figure out how to get nested search working
    // localStorageKey: "schemas.tables.path",
    // defaultSortField: "schemas.tables.path",
    searchFields: ["databaseName"],
    localStorageKey: "databaseName",
    defaultSortField: "databaseName",
  });

  const handleTableClick = async (
    e,
    databaseName: string,
    schemaName: string,
    tableName: string,
    path: string
  ) => {
    if (e.detail === 2) {
      if (!inputArray) return;
      const updatedStr = pastePathIntoExistingQuery(
        inputArray[row] || "",
        column,
        path
      );

      const updatedInputArray = cloneDeep(inputArray);
      updatedInputArray[row] = updatedStr;

      updateSqlInput(updatedInputArray.join("\n"));
    }

    // If the table is already fetched, don't fetch it again
    if (
      currentTable?.tableName === tableName &&
      currentTable?.databaseName === databaseName &&
      currentTable?.tableSchema === schemaName
    )
      return;

    try {
      setLoading(true);
      setCurrentTable(null);

      const res = await apiCall<{
        status: number;
        table?: InformationSchemaTablesInterface;
      }>(
        `/informationSchema/${informationSchema.id}/${databaseName}/${schemaName}/${tableName}`,
        {
          method: "GET",
        }
      );
      setCurrentTable(res.table);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    setCurrentTable(null);
  }, [datasource]);

  if (informationSchema?.error) {
    return (
      <SchemaBrowserWrapper datasourceName={datasource.name}>
        <RetryInformationSchemaCard
          datasourceId={datasource.id}
          mutate={mutate}
          informationSchemaError={informationSchema.error}
          informationSchemaId={informationSchema.id}
        />
      </SchemaBrowserWrapper>
    );
  }

  if (informationSchema?.status === "PENDING") {
    return (
      <SchemaBrowserWrapper datasourceName={datasource.name}>
        <PendingInformationSchemaCard
          datasourceId={datasource.id}
          mutate={mutate}
        />
      </SchemaBrowserWrapper>
    );
  }

  return (
    <>
      <SchemaBrowserWrapper datasourceName={datasource.name}>
        {!informationSchema || !informationSchema.databases.length ? (
          <BuildInformationSchemaCard
            datasourceId={datasource.id}
            mutate={mutate}
          />
        ) : (
          <>
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
              className="mb-2"
            />
            <div
              key="database"
              className="border rounded p-1"
              style={{
                minHeight: "100px",
                maxHeight: "210px",
                overflowY: "scroll",
              }}
            >
              {items.map((database) => {
                return (
                  <>
                    {database.schemas.map((schema) => {
                      return (
                        <div key={schema.schemaName} className="pb-2">
                          <Collapsible
                            className="pb-1"
                            key={database.databaseName + schema.schemaName}
                            onTriggerOpening={async () => {
                              const currentDate = new Date();
                              const dateLastUpdated = new Date(
                                informationSchema.dateUpdated
                              );
                              // To calculate the time difference of two dates
                              const diffInMilliseconds =
                                currentDate.getTime() -
                                dateLastUpdated.getTime();

                              // To calculate the no. of days between two dates
                              const diffInDays = Math.floor(
                                diffInMilliseconds / (1000 * 3600 * 24)
                              );

                              if (diffInDays > 30) {
                                await apiCall<{
                                  status: number;
                                  message?: string;
                                }>(
                                  `/datasource/${datasource.id}/informationSchema`,
                                  {
                                    method: "PUT",
                                    body: JSON.stringify({
                                      informationSchemaId: informationSchema.id,
                                    }),
                                  }
                                );
                              }
                            }}
                            trigger={
                              datasource.type === ("bigquery" || "postgres") ? (
                                <>
                                  <FaAngleRight />
                                  {`${database.databaseName}.${schema.schemaName}`}
                                </>
                              ) : (
                                <>
                                  <FaAngleRight />
                                  {`${schema.schemaName}`}
                                </>
                              )
                            }
                            triggerWhenOpen={
                              datasource.type === ("bigquery" || "postgres") ? (
                                <>
                                  <FaAngleDown />
                                  {`${database.databaseName}.${schema.schemaName}`}
                                </>
                              ) : (
                                <>
                                  <FaAngleDown />
                                  {`${schema.schemaName}`}
                                </>
                              )
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
                                  style={{ userSelect: "none" }}
                                  role="button"
                                  key={
                                    database.databaseName +
                                    schema.schemaName +
                                    table.tableName
                                  }
                                  onClick={async (e) =>
                                    handleTableClick(
                                      e,
                                      database.databaseName,
                                      schema.schemaName,
                                      table.tableName,
                                      table.path
                                    )
                                  }
                                >
                                  <FaTable /> {table.tableName}
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
          </>
        )}
      </SchemaBrowserWrapper>
      {error && <div className="alert alert-danger">{error}</div>}
      <DatasourceTableData table={currentTable} loading={loading} />
    </>
  );
}
