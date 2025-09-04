import { InformationSchemaInterfaceWithPaths } from "back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight, FaTable } from "react-icons/fa";
import { cloneDeep } from "lodash";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { CursorData } from "@/components/Segments/SegmentForm";
import LoadingSpinner from "@/components/LoadingSpinner";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import SchemaBrowserWrapper from "./SchemaBrowserWrapper";
import RetryInformationSchemaCard from "./RetryInformationSchemaCard";
import PendingInformationSchemaCard from "./PendingInformationSchemaCard";
import BuildInformationSchemaCard from "./BuildInformationSchemaCard";
import DatasourceTableData from "./DatasourceTableData";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  cursorData?: CursorData;
  updateSqlInput?: (sql: string) => void;
};

export default function SchemaBrowser({
  datasource,
  updateSqlInput,
  cursorData,
}: Props) {
  const { data, mutate } = useApi<{
    informationSchema: InformationSchemaInterfaceWithPaths;
  }>(`/datasource/${datasource.id}/schema`);

  const informationSchema = data?.informationSchema;
  const permissionsUtil = usePermissionsUtil();
  const canRunQueries = permissionsUtil.canRunSchemaQueries(datasource);

  const { apiCall } = useAuth();
  const [currentTable, setCurrentTable] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);

  const [retryCount, setRetryCount] = useState(1);

  const row = cursorData?.row || 0;
  const column = cursorData?.column || 0;
  const inputArray = useMemo(
    () => cursorData?.input || [],
    [cursorData?.input],
  );

  const refreshOrCreateInfoSchema = useCallback(
    async (type: "PUT" | "POST") => {
      setError(null);
      try {
        await apiCall<{
          status: number;
          message?: string;
        }>(`/datasource/${datasource.id}/schema`, {
          method: type,
          body: JSON.stringify({
            informationSchemaId: informationSchema?.id,
          }),
        });
        setFetching(true);
      } catch (e) {
        setError(e.message);
      }
    },
    [apiCall, datasource.id, informationSchema?.id],
  );

  function pastePathIntoExistingQuery(
    existingQuery: string,
    index: number,
    pathToPaste: string,
  ) {
    if (index === existingQuery.length - 1) return existingQuery + pathToPaste;
    return (
      existingQuery.substring(0, index) +
      pathToPaste +
      existingQuery.substring(index)
    );
  }

  const handleTableClick = useCallback(
    async (e, path: string, tableId: string) => {
      setError(null);
      if (e.detail === 2) {
        if (!inputArray || !updateSqlInput) return;
        const updatedStr = pastePathIntoExistingQuery(
          inputArray[row] || "",
          column,
          path,
        );

        const updatedInputArray = cloneDeep(inputArray);
        updatedInputArray[row] = updatedStr;

        updateSqlInput(updatedInputArray.join("\n"));
      }

      setCurrentTable(tableId);
    },
    [inputArray, updateSqlInput, row, column],
  );

  useEffect(() => {
    if (fetching) {
      if (
        retryCount > 1 &&
        retryCount < 8 &&
        informationSchema?.status === "COMPLETE"
      ) {
        setFetching(false);
        setRetryCount(1);
      } else if (retryCount > 8) {
        setFetching(false);
        setError(
          "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes.",
        );
        setRetryCount(1);
      } else {
        const timer = setTimeout(() => {
          mutate();
          setRetryCount(retryCount * 2);
        }, retryCount * 1000);
        return () => {
          clearTimeout(timer);
        };
      }
    }
  }, [fetching, mutate, retryCount, informationSchema]);

  useEffect(() => {
    setCurrentTable("");
  }, [datasource]);

  // This is hacky - since we updated the logic to support BigQuery data sources with multiple schemas there are some old data sources that have a now outdated error
  // This check looks for that, and if it finds it, it will refresh the schema automatically
  useEffect(() => {
    if (
      !fetching &&
      informationSchema?.error &&
      informationSchema?.error.message ===
        "No schema provided. Please edit the connection settings and try again." &&
      datasource.type === "bigquery"
    ) {
      refreshOrCreateInfoSchema("PUT");
    }
  }, [
    datasource.type,
    fetching,
    informationSchema?.error,
    refreshOrCreateInfoSchema,
  ]);

  if (!data) return <LoadingSpinner />;

  return (
    <div className="d-flex flex-column h-100">
      <PanelGroup direction="vertical">
        <Panel
          id="schema-browser"
          order={1}
          defaultSize={currentTable ? 50 : 100}
          minSize={11}
        >
          <SchemaBrowserWrapper
            datasourceName={datasource.name}
            datasourceId={datasource.id}
            canRunQueries={canRunQueries}
            informationSchema={informationSchema}
            setFetching={setFetching}
            fetching={fetching}
            setError={setError}
          >
            {informationSchema?.databases.length &&
            !informationSchema?.error &&
            informationSchema?.status === "COMPLETE" ? (
              <div
                className="p-1"
                style={{
                  overflowY: "auto",
                  height: "100%",
                  minHeight: 0,
                }}
              >
                {informationSchema.databases.map((database, i) => {
                  return (
                    <Fragment key={i}>
                      {database.schemas.map((schema, j) => {
                        return (
                          <div key={j}>
                            <Collapsible
                              className="pb-1"
                              lazyRender={true}
                              onTriggerOpening={async () => {
                                const currentDate = new Date();
                                const dateLastUpdated = new Date(
                                  informationSchema.dateUpdated,
                                );
                                // To calculate the time difference of two dates
                                const diffInMilliseconds =
                                  currentDate.getTime() -
                                  dateLastUpdated.getTime();

                                // To calculate the no. of days between two dates
                                const diffInDays = Math.floor(
                                  diffInMilliseconds / (1000 * 3600 * 24),
                                );

                                if (diffInDays > 30) {
                                  await apiCall<{
                                    status: number;
                                    message?: string;
                                  }>(`/datasource/${datasource.id}/schema`, {
                                    method: "PUT",
                                    body: JSON.stringify({
                                      informationSchemaId: informationSchema.id,
                                    }),
                                  });
                                }
                              }}
                              trigger={
                                ["bigquery", "postgres"].includes(
                                  datasource.type,
                                ) ? (
                                  <>
                                    <FaAngleRight />
                                    {`${database.databaseName}.${schema.schemaName}`}
                                  </>
                                ) : datasource.type ===
                                  "growthbook_clickhouse" ? (
                                  <>
                                    <FaAngleRight />
                                    Tables
                                  </>
                                ) : (
                                  <>
                                    <FaAngleRight />
                                    {`${schema.schemaName}`}
                                  </>
                                )
                              }
                              triggerWhenOpen={
                                ["bigquery", "postgres"].includes(
                                  datasource.type,
                                ) ? (
                                  <>
                                    <FaAngleDown />
                                    {`${database.databaseName}.${schema.schemaName}`}
                                  </>
                                ) : datasource.type ===
                                  "growthbook_clickhouse" ? (
                                  <>
                                    <FaAngleRight />
                                    Tables
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
                              {schema.tables.map((table, k) => {
                                return (
                                  <div
                                    className={clsx(
                                      table.id === currentTable &&
                                        "bg-secondary rounded text-white",
                                      "pl-3 py-1",
                                    )}
                                    style={{ userSelect: "none" }}
                                    role="button"
                                    key={k}
                                    onClick={(e) =>
                                      handleTableClick(e, table.path, table.id)
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
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              <div className="p-2">
                {!informationSchema && !fetching && (
                  <BuildInformationSchemaCard
                    error={error}
                    canRunQueries={canRunQueries}
                    refreshOrCreateInfoSchema={(type) =>
                      refreshOrCreateInfoSchema(type)
                    }
                  />
                )}
                {(informationSchema?.status === "PENDING" || fetching) && (
                  <PendingInformationSchemaCard mutate={mutate} />
                )}
                {!fetching && informationSchema?.error && (
                  <RetryInformationSchemaCard
                    error={error}
                    canRunQueries={canRunQueries}
                    informationSchema={informationSchema}
                    refreshOrCreateInfoSchema={(type) =>
                      refreshOrCreateInfoSchema(type)
                    }
                  />
                )}
              </div>
            )}
          </SchemaBrowserWrapper>
        </Panel>

        {currentTable && (
          <>
            <PanelResizeHandle />
            <Panel id="table-data" order={2} defaultSize={50} minSize={5}>
              <DatasourceTableData
                datasource={datasource}
                canRunQueries={canRunQueries}
                tableId={currentTable}
                datasourceId={datasource.id}
                setError={setError}
              />
            </Panel>
          </>
        )}
      </PanelGroup>

      {error && <div className="alert alert-danger mt-2 mb-0">{error}</div>}
    </div>
  );
}
