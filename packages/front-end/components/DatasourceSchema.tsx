import {
  InformationSchema,
  InformationSchemaInterface,
  InformationSchemaTablesInterface,
} from "@/../back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import React, { useEffect, useState } from "react";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight, FaDatabase, FaTable } from "react-icons/fa";
import { cloneDeep } from "lodash";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import DatasourceTableData from "./DatasourceTableData";
import Field from "./Forms/Field";
import Button from "./Button";
import LoadingSpinner from "./LoadingSpinner";
import { CursorData } from "./Segments/SegmentForm";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  informationSchema: InformationSchemaInterface;
  mutate: () => void;
  cursorData: CursorData;
  updateSqlInput: (sql: string) => void;
};

export default function DatasourceSchema({
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
  const [error, setError] = useState<null | string>(null);
  const [
    generatingInformationSchema,
    setGeneratingInformationSchema,
  ] = useState(false);

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

  const row = cursorData?.row;
  const column = cursorData?.column;
  const inputArray = cursorData?.input;

  useEffect(() => {
    setCurrentTable(null);
  }, [datasource]);

  const { items, searchInputProps } = useSearch({
    items: (informationSchema?.databases as InformationSchema[]) || [],
    // searchFields: ["schemas.tables.path"], //MKTODO: Figure out how to get nested search working
    // localStorageKey: "schemas.tables.path",
    // defaultSortField: "schemas.tables.path",
    searchFields: ["databaseName"],
    localStorageKey: "databaseName",
    defaultSortField: "databaseName",
  });

  if (!datasource) {
    return null;
  }

  const handleClick = async (
    e,
    databaseName: string,
    schemaName: string,
    tableName: string,
    path: string
  ) => {
    if (e.detail === 2) {
      if (!inputArray) return;
      const updatedStr = pastePathIntoExistingQuery(
        inputArray[row],
        column,
        path
      );

      const updatedInputArray = cloneDeep(cursorData.input);
      updatedInputArray[row] = updatedStr;

      updateSqlInput(updatedInputArray.join("\n"));
    }

    // If the table is already fetched, dont' fetch it again
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
        `/datasourceId/${datasource.id}/database/${databaseName}/schema/${schemaName}/table/${tableName}`,
        {
          method: "GET",
        }
      );
      setCurrentTable(res.table);
      setLoading(false);
    } catch (e) {
      console.log("e", e);
    }
  };

  return (
    <div className="d-flex flex-column">
      <div>
        <div className="d-flex justify-content-between align-items-center pb-1">
          <label className="font-weight-bold mb-1">
            <FaDatabase /> {datasource.name}
          </label>
          <Button
            onClick={async () => {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              console.log("This hasn't been implemented yet");
            }}
            color="link text-success btn-sm"
          >
            Refresh Schema
          </Button>
        </div>
        {!informationSchema ? (
          <div>
            <div className="alert alert-info">
              Need help building your query? Click the button to the right to
              get insight into what tables and columns are available in the
              datasource.
              <Button
                className="mt-2"
                onClick={async () => {
                  setGeneratingInformationSchema(true);
                  setError(null);
                  const res = await apiCall<{
                    status: number;
                    message?: string;
                  }>(`/datasource/${datasource.id}/informationSchema`, {
                    method: "POST",
                  });

                  setGeneratingInformationSchema(false);
                  if (res.status > 200) {
                    setError(res.message);
                  }
                  mutate();
                }}
              >
                Generate Information Schema
              </Button>
              {generatingInformationSchema && <LoadingSpinner />}
              {error && <div className="alert alert-warning">{error}</div>}
            </div>
          </div>
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
                                    handleClick(
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
      </div>
      <DatasourceTableData table={currentTable} loading={loading} />
    </div>
  );
}
