import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useCallback, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { format } from "sql-formatter";
import { FaPlay } from "react-icons/fa";
import clsx from "clsx";
import Split from "react-split";
import { InformationSchemaInterface } from "back-end/src/types/Integration";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Modal from "../Modal";
import CodeTextArea, { AceCompletion } from "../Forms/CodeTextArea";
import DisplayTestQueryResults from "../Settings/DisplayTestQueryResults";
import Callout from "../Radix/Callout";
import { CursorData } from "../Segments/SegmentForm";
import Button from "../Radix/Button";
import Checkbox from "../Radix/Checkbox";
import { TestQueryResults } from "./EditSqlModal";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./DataExplorer.module.scss";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  close: () => void;
};

export default function DataExplorerModal({ datasource, close }: Props) {
  const { apiCall } = useAuth();
  const [sql, setSql] = useState("");
  const [limitQuery, setLimitQuery] = useState(true);
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
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

  function formatSql() {
    const formattedSql = format(sql, {
      language: "sql",
    });

    setSql(formattedSql);
  }

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      size="max"
      close={close}
      closeCta="Close"
      header="Data Explorer"
    >
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
            <Split
              sizes={[50, 50]}
              minSize={100}
              expandToMin={false}
              gutterSize={10}
              gutterAlign="center"
              snapOffset={30}
              dragInterval={1}
              direction="vertical"
              cursor="col-resize"
            >
              <div className="border-bottom">
                <Flex align="center" className="pb-2">
                  <Button
                    loading={testingQuery}
                    onClick={handleQuery}
                    disabled={!canRunQueries}
                    mr="2"
                  >
                    <span className="pr-2">
                      <FaPlay />
                    </span>{" "}
                    Run
                  </Button>
                  <Button variant="ghost" onClick={formatSql}>
                    Format
                  </Button>
                  <div className="pl-2">
                    <Checkbox
                      label="Limit 100"
                      value={limitQuery}
                      setValue={setLimitQuery}
                    />
                  </div>
                </Flex>
                <CodeTextArea
                  required
                  language="sql"
                  value={sql}
                  setValue={setSql}
                  placeholder="This is a sample placeholder"
                  minLines={15}
                  setCursorData={setCursorData}
                  onCtrlEnter={handleQuery}
                  onCtrlS={formatSql}
                  resizeDependency={!!testQueryResults}
                  completions={autoCompletions}
                />
              </div>
              {testQueryResults && (
                <DisplayTestQueryResults
                  duration={parseInt(testQueryResults.duration || "0")}
                  results={testQueryResults.results || []}
                  sql={testQueryResults.sql || ""}
                  error={testQueryResults.error || ""}
                  close={() => setTestQueryResults(null)}
                  allowDownloads={true}
                  dismissable={false}
                  header={`Query Results (${testQueryResults.results?.length} Rows)`}
                />
              )}
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
    </Modal>
  );
}
