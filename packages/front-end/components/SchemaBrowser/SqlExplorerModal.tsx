import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay, FaExclamationTriangle } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Button";
import RadixButton from "@/components/Radix/Button";
import {
  usesEventName,
  usesValueColumn,
} from "@/components/Metrics/MetricForm";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { formatSql, canFormatSql } from "@/services/sqlFormatter";
import SelectField from "@/components/Forms/SelectField";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

export type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

export interface Props {
  close: () => void;
  datasourceId?: string;
  onRunQuery?: (sql: string, datasourceId: string) => void;
}

export default function SqlExplorerModal({
  close,
  datasourceId: initialDatasourceId,
  onRunQuery,
}: Props) {
  const [step, setStep] = useState(initialDatasourceId ? 1 : 0);
  const [selectedDatasourceId, setSelectedDatasourceId] = useState(
    initialDatasourceId || ""
  );
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const [testQueryBeforeSaving, setTestQueryBeforeSaving] = useState(true);
  const form = useForm({
    defaultValues: {
      sql: "",
    },
  });

  const { getDatasourceById, datasources } = useDefinitions();
  const { apiCall } = useAuth();
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [testingQuery, setTestingQuery] = useState(false);
  const permissionsUtil = usePermissionsUtil();
  const [formatError, setFormatError] = useState<string | null>(null);
  const [templateVariables, setTemplateVariables] = useState<{
    eventName?: string;
    valueColumn?: string;
  }>({});

  const datasource = getDatasourceById(selectedDatasourceId);
  const canRunQueries = datasource
    ? permissionsUtil.canRunTestQueries(datasource)
    : null;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const hasEventName = usesEventName(form.watch("sql"));
  const hasValueCol = usesValueColumn(form.watch("sql"));

  const runTestQuery = useCallback(
    async (sql: string): Promise<TestQueryResults> => {
      if (!selectedDatasourceId) {
        throw new Error("No data source selected");
      }

      validateSQL(sql, []);
      setTestQueryResults(null);
      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: selectedDatasourceId,
          templateVariables: templateVariables,
        }),
      });

      return res;
    },
    [apiCall, selectedDatasourceId, templateVariables]
  );

  const handleTestQuery = useCallback(async () => {
    setTestingQuery(true);
    const sql = form.getValues("sql");
    try {
      const res = await runTestQuery(sql);
      setTestQueryResults({ ...res, error: res.error ? res.error : "" });
    } catch (e) {
      setTestQueryResults({ sql: sql, error: e.message });
    }
    setTestingQuery(false);
  }, [form, runTestQuery]);

  const handleFormatClick = () => {
    const result = formatSql(form.watch("sql"), datasource?.type);
    if (result.error) {
      setFormatError(result.error);
    } else if (result.formattedSql) {
      form.setValue("sql", result.formattedSql);
      setFormatError(null);
    }
  };

  const handleRunQuery = () => {
    const sql = form.getValues("sql");
    if (onRunQuery && selectedDatasourceId) {
      onRunQuery(sql, selectedDatasourceId);
    }
    close();
  };

  useEffect(() => {
    if (!canRunQueries) setTestQueryBeforeSaving(false);
  }, [canRunQueries]);

  // Filter datasources to only those that support SQL queries
  const validDatasources = datasources.filter(
    (d) => d.type !== "google_analytics"
  );

  return (
    <PagedModal
      trackingEventModalType="sql-explorer"
      header="SQL Explorer"
      close={close}
      size="max"
      bodyClassName="p-0"
      cta={step === 0 ? "Next" : "Run Query"}
      closeCta="Cancel"
      step={step}
      setStep={setStep}
      ctaEnabled={step === 0 ? !!selectedDatasourceId : !!form.watch("sql")}
      submit={async () => {
        if (step === 0) {
          setStep(1);
        } else {
          if (testQueryBeforeSaving) {
            let res: TestQueryResults;
            try {
              res = await runTestQuery(form.getValues("sql"));
            } catch (e) {
              setTestQueryResults({
                sql: form.getValues("sql"),
                error: e.message,
              });
              throw new Error();
            }
            if (res.error) {
              setTestQueryResults(res);
              throw new Error();
            }
          }
          handleRunQuery();
        }
      }}
      secondaryCTA={
        step === 1 ? (
          <Tooltip
            body="You do not have permission to run test queries"
            shouldDisplay={!canRunQueries}
            tipPosition="top"
          >
            <label className="mx-4 mb-0">
              <input
                type="checkbox"
                disabled={!canRunQueries}
                className="form-check-input"
                checked={testQueryBeforeSaving}
                onChange={(e) => setTestQueryBeforeSaving(e.target.checked)}
              />
              Test query before running
            </label>
          </Tooltip>
        ) : undefined
      }
    >
      <Page display="Select Data Source">
        <div className="p-4">
          <h3>Choose a Data Source</h3>
          <p className="text-muted mb-4">
            Select the data source you want to explore with SQL queries.
          </p>
          <SelectField
            label="Data Source"
            value={selectedDatasourceId}
            onChange={(value) => setSelectedDatasourceId(value)}
            options={validDatasources.map((d) => ({
              value: d.id,
              label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
            }))}
            className="portal-overflow-ellipsis"
            placeholder="Choose a data source..."
            required
          />
        </div>
      </Page>

      <Page display="SQL Editor">
        <div
          className={clsx("d-flex", {
            [styles["with-schema-browser"]]: supportsSchemaBrowser,
          })}
          style={{
            height: "calc(93vh - 140px)",
          }}
        >
          <div className={styles.left}>
            <div className="d-flex flex-column h-100">
              <div className="bg-light p-1">
                <div className="row align-items-center">
                  <div className="col-auto">
                    <Flex align="center">
                      <Tooltip
                        body="You do not have permission to run test queries"
                        shouldDisplay={!canRunQueries}
                      >
                        <Button
                          color="primary"
                          className="btn-sm"
                          onClick={handleTestQuery}
                          loading={testingQuery}
                          disabled={!canRunQueries}
                          type="button"
                        >
                          <span className="pr-2">
                            <FaPlay />
                          </span>
                          Test Query
                        </Button>
                      </Tooltip>
                      {canFormat ? (
                        <RadixButton
                          variant="ghost"
                          onClick={handleFormatClick}
                          disabled={!form.watch("sql")}
                        >
                          Format
                        </RadixButton>
                      ) : null}
                      {formatError && (
                        <Tooltip body={formatError}>
                          <FaExclamationTriangle className="text-danger" />
                        </Tooltip>
                      )}
                    </Flex>
                  </div>
                </div>
              </div>
              {(hasEventName || hasValueCol) && (
                <div className="bg-light px-3 py-1 border-top form-inline">
                  <div className="row align-items-center">
                    <div className="col-auto">
                      <strong>SQL Template Variables:</strong>
                    </div>
                    {hasEventName && (
                      <div className="col-auto">
                        <Field
                          label="eventName"
                          labelClassName="mr-2"
                          value={templateVariables?.eventName || ""}
                          onChange={(e) =>
                            setTemplateVariables({
                              ...templateVariables,
                              eventName: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.ctrlKey) {
                              handleTestQuery();
                            }
                          }}
                        />
                      </div>
                    )}
                    {hasValueCol && (
                      <div className="col-auto">
                        <Field
                          label="valueColumn"
                          labelClassName="mr-2"
                          value={templateVariables?.valueColumn || ""}
                          onChange={(e) =>
                            setTemplateVariables({
                              ...templateVariables,
                              valueColumn: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.ctrlKey) {
                              handleTestQuery();
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="" style={{ flex: 1 }}>
                <CodeTextArea
                  required
                  language="sql"
                  value={form.watch("sql")}
                  setValue={(v) => {
                    if (formatError) {
                      setFormatError(null);
                    }
                    form.setValue("sql", v);
                  }}
                  placeholder="Enter your SQL query here..."
                  helpText={""}
                  fullHeight
                  setCursorData={setCursorData}
                  onCtrlEnter={handleTestQuery}
                  resizeDependency={!!testQueryResults}
                />
              </div>
              {testQueryResults && (
                <DisplayTestQueryResults
                  duration={parseInt(testQueryResults.duration || "0")}
                  results={testQueryResults.results || []}
                  sql={testQueryResults.sql || ""}
                  error={testQueryResults.error || ""}
                  close={() => setTestQueryResults(null)}
                />
              )}
            </div>
          </div>
          {supportsSchemaBrowser && (
            <div className={styles.right + " border-left"}>
              <SchemaBrowser
                updateSqlInput={(sql: string) => {
                  form.setValue("sql", sql);
                }}
                datasource={datasource}
                cursorData={cursorData || undefined}
              />
            </div>
          )}
        </div>
      </Page>
    </PagedModal>
  );
}
