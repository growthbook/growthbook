import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useCallback, useState } from "react";
import { format } from "sql-formatter";
import { InformationSchemaInterface } from "back-end/src/types/Integration";
import clsx from "clsx";
import Split from "react-split";
import { Flex } from "@radix-ui/themes";
import { FaPlay } from "react-icons/fa";
import { FaWandSparkles } from "react-icons/fa6";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Button from "../Radix/Button";
import Callout from "../Radix/Callout";
import CodeTextArea, { AceCompletion } from "../Forms/CodeTextArea";
import { CursorData } from "../Segments/SegmentForm";
import Checkbox from "../Radix/Checkbox";
import DisplayTestQueryResults from "../Settings/DisplayTestQueryResults";
import Tooltip from "../Tooltip/Tooltip";
import QueryGeneratorModal from "../SQLQueryGenerator/QueryGeneratorModal";
import styles from "./DataExplorer.module.scss";
import { TestQueryResults } from "./EditSqlModal";
import SchemaBrowser from "./SchemaBrowser";

export default function DataExplorer({
  datasource,
}: {
  datasource: DataSourceInterfaceWithParams;
}) {
  const { apiCall } = useAuth();
  const [sql, setSql] = useState("");
  const [limitQuery, setLimitQuery] = useState(true);
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [showGenerateQueryModal, setShowGenerateQueryModal] = useState(false);
  const [testingQuery, setTestingQuery] = useState(false);
  const [testQueryResults, setTestQueryResults] =
    useState<TestQueryResults | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;
  const canRunQueries = datasource
    ? permissionsUtil.canRunTestQueries(datasource)
    : null;

  const { data } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(`/datasource/${datasource.id}/schema`);
  const informationSchema = data?.informationSchema;
  const autoCompletions: AceCompletion[] = [];

  type MetaLabel =
    | "PROJECT"
    | "CATALOG"
    | "DATABASE"
    | "SCHEMA"
    | "TABLE"
    | null;

  function getMetaLabel(
    entityType: "top-level" | "schema",
    warehouse: string
  ): MetaLabel {
    const w = warehouse.toLowerCase();

    if (entityType === "top-level") {
      switch (w) {
        case "bigquery":
          return "PROJECT";
        case "trino":
        case "presto":
        case "databricks":
          return "CATALOG";
        default:
          return "DATABASE";
      }
    }

    if (entityType === "schema") {
      switch (w) {
        case "mysql":
        case "mariadb":
        case "clickhouse":
          return "DATABASE"; // or null to skip
        default:
          return "SCHEMA";
      }
    }
    return null;
  }

  // Get schema info for auto-completions
  if (informationSchema) {
    informationSchema.databases.forEach((database) => {
      if (database.path) {
        autoCompletions.push({
          value: database.databaseName,
          meta: getMetaLabel("top-level", datasource.type) || "DATABASE",
          score: 900,
          caption: database.databaseName,
        });
      }
      database.schemas.forEach((schema) => {
        if (schema.path) {
          autoCompletions.push({
            value: schema.schemaName,
            meta: getMetaLabel("schema", datasource.type) || "SCHEMA",
            score: 900,
            caption: schema.schemaName,
          });
        }
        schema.tables.forEach((table) => {
          if (table.path) {
            autoCompletions.push({
              value: table.path,
              meta: "TABLE",
              score: 900,
              caption: table.tableName,
            });
          }
        });
      });
    });
  }

  const runTestQuery = useCallback(
    async (sql: string) => {
      setTestQueryResults(null);
      const res: TestQueryResults = await apiCall("/query/run", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: datasource.id,
          limit: limitQuery ? 100 : undefined,
        }),
      });
      return res;
    },
    [apiCall, datasource.id, limitQuery]
  );

  const handleQuery = useCallback(async () => {
    setTestingQuery(true);
    try {
      const res = await runTestQuery(sql);
      setTestQueryResults({ ...res, error: res.error ? res.error : "" });
    } catch (e) {
      setTestQueryResults({ sql: sql, error: e.message, results: [] });
    }
    setTestingQuery(false);
  }, [runTestQuery, sql]);

  function formatSql(sql: string): string {
    return format(sql, {
      language: "sql",
    });
  }
  return (
    <>
      {showGenerateQueryModal ? (
        <QueryGeneratorModal
          open={true}
          datasourceType={datasource.type}
          informationSchema={informationSchema}
          format={(value) => formatSql(value)}
          setSql={(value: string) => {
            setSql(value);
            setShowGenerateQueryModal(false);
          }}
          close={() => setShowGenerateQueryModal(false)}
        />
      ) : null}
      {!canRunQueries ? (
        <Callout status="error">
          You do not have permission to run queries on this data source.
        </Callout>
      ) : (
        <div
          className={clsx("d-flex", {
            [styles["with-schema-browser"]]: supportsSchemaBrowser,
          })}
          style={{
            height: "calc(93vh - 140px)",
            display: "flex",
          }}
        >
          <div className={styles.left}>
            <Split direction="vertical">
              <div
                className="border-bottom"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                <Flex align="center" justify="between" className="pb-2">
                  <Flex align="center">
                    <Button
                      loading={testingQuery}
                      onClick={handleQuery}
                      disabled={!canRunQueries || !sql}
                      mr="2"
                    >
                      <span className="pr-2">
                        <FaPlay />
                      </span>{" "}
                      Run
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setSql(formatSql(sql))}
                      disabled={!sql}
                    >
                      Format
                    </Button>
                    <div className="pl-2">
                      <Checkbox
                        disabled={!sql}
                        label="Limit 100"
                        value={limitQuery}
                        setValue={setLimitQuery}
                      />
                    </div>
                  </Flex>
                  <div>
                    <Tooltip body="Use natural language to generate queries">
                      <Button onClick={() => setShowGenerateQueryModal(true)}>
                        Generate SQL <FaWandSparkles className="ml-1" />
                      </Button>
                    </Tooltip>
                  </div>
                </Flex>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <CodeTextArea
                    required
                    language="sql"
                    value={sql}
                    setValue={setSql}
                    placeholder="Type a query to get started"
                    minLines={15}
                    setCursorData={setCursorData}
                    onCtrlEnter={handleQuery}
                    onCtrlS={() => setSql(formatSql(sql))}
                    resizeDependency={!!testQueryResults}
                    completions={autoCompletions}
                  />
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  paddingTop: "5px",
                }}
              >
                {testQueryResults ? (
                  <DisplayTestQueryResults
                    duration={parseInt(testQueryResults?.duration || "0")}
                    results={testQueryResults?.results || []}
                    sql={testQueryResults?.sql || ""}
                    error={testQueryResults?.error || ""}
                    close={() => setTestQueryResults(null)}
                    allowDownloads={true}
                    dismissable={false}
                    header={`Query Results (${
                      testQueryResults?.results?.length || 0
                    } Rows)`}
                  />
                ) : null}
              </div>
            </Split>
          </div>
          {supportsSchemaBrowser && (
            <div className={styles.right + " border-left"}>
              <SchemaBrowser
                updateSqlInput={(sql: string) => {
                  setSql(sql);
                }}
                datasource={datasource}
                cursorData={cursorData || undefined}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
