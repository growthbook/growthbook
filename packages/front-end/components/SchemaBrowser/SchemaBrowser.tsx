import {
  InformationSchemaInterface,
  Table,
} from "back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import React, {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react";
import { cloneDeep } from "lodash";
import { List, ListImperativeAPI } from "react-window";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight, FaTable } from "react-icons/fa";
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
import { getTablePath } from "@/services/datasources";
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

// Schema item component for virtualized list
interface SchemaItemProps {
  index: number;
  style: React.CSSProperties;
  schemas: Array<{
    databaseName: string;
    schemaName: string;
    tables: Table[];
    displayName: string;
    id: string;
  }>;
  currentTable: string;
  datasource: DataSourceInterfaceWithParams;
  informationSchema: InformationSchemaInterface;
  apiCall: <T>(
    url: string | null,
    options?: RequestInit,
    errorHandler?: (error: Error) => void,
  ) => Promise<T>;
  onTableClick: (
    e: React.MouseEvent,
    params: {
      catalog: string;
      schema: string;
      tableName: string;
    },
    tableId: string,
  ) => void;
  expandedSchemas: Set<string>;
  onToggleExpansion: (schemaId: string) => void;
}

const SchemaItem = React.memo(
  ({
    index,
    style,
    schemas,
    currentTable,
    datasource,
    informationSchema,
    apiCall,
    onTableClick,
    expandedSchemas,
    onToggleExpansion,
  }: SchemaItemProps) => {
    const schemaItem = schemas[index];
    const isExpanded = expandedSchemas.has(schemaItem.id);

    return (
      <div style={style}>
        <Collapsible
          className="pb-1"
          open={isExpanded}
          onTriggerOpening={async () => {
            if (!isExpanded) {
              onToggleExpansion(schemaItem.id);
            }

            const currentDate = new Date();
            const dateLastUpdated = new Date(informationSchema.dateUpdated);
            // To calculate the time difference of two dates
            const diffInMilliseconds =
              currentDate.getTime() - dateLastUpdated.getTime();

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
          onTriggerClosing={() => {
            if (isExpanded) {
              onToggleExpansion(schemaItem.id);
            }
          }}
          trigger={
            <>
              <FaAngleRight />
              {schemaItem.displayName}
            </>
          }
          triggerWhenOpen={
            <>
              <FaAngleDown />
              {schemaItem.displayName}
            </>
          }
          triggerStyle={{
            fontWeight: "bold",
            whiteSpace: "nowrap",
          }}
          transitionTime={1}
        >
          {schemaItem.tables.map((table, k) => {
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
                onClick={async (e) =>
                  onTableClick(
                    e,
                    {
                      catalog: schemaItem.databaseName,
                      schema: schemaItem.schemaName,
                      tableName: table.tableName,
                    },
                    table.id,
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
  },
);

SchemaItem.displayName = "SchemaItem";

export default function SchemaBrowser({
  datasource,
  updateSqlInput,
  cursorData,
}: Props) {
  const { data, mutate } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(`/datasource/${datasource.id}/schema`);

  const informationSchema = data?.informationSchema;
  const permissionsUtil = usePermissionsUtil();
  const canRunQueries = permissionsUtil.canRunSchemaQueries(datasource);

  const { apiCall } = useAuth();
  const [currentTable, setCurrentTable] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const listRef = useRef<ListImperativeAPI | null>(null);

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
    async (
      e: React.MouseEvent,
      params: {
        catalog: string;
        schema: string;
        tableName: string;
      },
      tableId: string,
    ) => {
      setError(null);
      if (e.detail === 2) {
        if (!inputArray || !updateSqlInput) return;
        const updatedStr = pastePathIntoExistingQuery(
          inputArray[row] || "",
          column,
          getTablePath(datasource.type, params),
        );

        const updatedInputArray = cloneDeep(inputArray);
        updatedInputArray[row] = updatedStr;

        updateSqlInput(updatedInputArray.join("\n"));
      }

      setCurrentTable(tableId);
    },
    [inputArray, updateSqlInput, row, column, datasource.type],
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

  const uniqueDbSchemaCombos: {
    databaseName: string;
    schemaName: string;
    tables: Table[];
    displayName: string;
    id: string;
  }[] = useMemo(() => {
    function getDisplayName(databaseName: string, schemaName: string) {
      if (datasource.type === "growthbook_clickhouse") {
        return "Tables";
      }

      if (["bigquery", "postgres"].includes(datasource.type)) {
        return `${databaseName}.${schemaName}`;
      }

      return schemaName;
    }
    const uniqueDbSchemaCombos: {
      databaseName: string;
      schemaName: string;
      tables: Table[];
      displayName: string;
      id: string;
    }[] = [];
    if (informationSchema?.databases) {
      informationSchema.databases.forEach((database, i) => {
        database.schemas.forEach((schema, j) => {
          uniqueDbSchemaCombos.push({
            databaseName: database.databaseName,
            schemaName: schema.schemaName,
            tables: schema.tables,
            displayName: getDisplayName(
              database.databaseName,
              schema.schemaName,
            ),
            id: `${i}-${j}`,
          });
        });
      });
    }
    return uniqueDbSchemaCombos;
  }, [informationSchema?.databases, datasource.type]);

  const maxSchemaListHeight = 700;
  const baseSchemaHeight = 30;
  const tableItemHeight = 29;

  // Function to calculate height for each schema item
  const getSchemaItemHeight = useCallback(
    (index: number) => {
      const schemaItem = uniqueDbSchemaCombos[index];
      if (!schemaItem) return baseSchemaHeight;

      const isExpanded = expandedSchemas.has(schemaItem.id);
      if (!isExpanded) return baseSchemaHeight;

      const tableCount = schemaItem.tables.length;
      // The height depends on if the schema is expanded or not AND if expanded, the number of tables
      const calculatedHeight = baseSchemaHeight + tableCount * tableItemHeight;

      return calculatedHeight;
    },
    [uniqueDbSchemaCombos, expandedSchemas],
  );

  // Toggle expansion state
  const toggleSchemaExpansion = useCallback((schemaId: string) => {
    setExpandedSchemas((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(schemaId)) {
        newSet.delete(schemaId);
      } else {
        newSet.add(schemaId);
      }
      return newSet;
    });

    // Note: react-window v2 doesn't have resetAfterIndex,
    // the component will automatically re-render when data changes
  }, []);

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
            {uniqueDbSchemaCombos?.length &&
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
                <List
                  listRef={listRef}
                  defaultHeight={maxSchemaListHeight}
                  rowCount={uniqueDbSchemaCombos.length}
                  rowHeight={getSchemaItemHeight}
                  rowProps={{}}
                  rowComponent={({ index, style }) => (
                    <SchemaItem
                      index={index}
                      style={style}
                      schemas={uniqueDbSchemaCombos}
                      currentTable={currentTable}
                      datasource={datasource}
                      informationSchema={informationSchema!}
                      apiCall={apiCall}
                      onTableClick={handleTableClick}
                      expandedSchemas={expandedSchemas}
                      onToggleExpansion={toggleSchemaExpansion}
                    />
                  )}
                  style={{ height: maxSchemaListHeight, width: "100%" }}
                />
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
