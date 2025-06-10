import { useCallback, useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { FaPlay, FaExclamationTriangle, FaSave } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import { SavedQuery } from "back-end/src/validators/saved-queries";
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
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import Checkbox from "../Radix/Checkbox";
import SchemaBrowser from "./SchemaBrowser";
import SaveQueryModal from "./SaveQueryModal";
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
  savedQuery?: SavedQuery;
  mutate: () => void;
}

export default function SqlExplorerModal({
  close,
  datasourceId: initialDatasourceId,
  savedQuery,
  mutate,
}: Props) {
  const [step, setStep] = useState(savedQuery || initialDatasourceId ? 1 : 0);
  const [selectedDatasourceId, setSelectedDatasourceId] = useState(
    savedQuery?.datasourceId || initialDatasourceId || ""
  );
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const [showSaveQueryModal, setShowSaveQueryModal] = useState(false);
  const previousDatasourceId = useRef(selectedDatasourceId);
  const form = useForm({
    defaultValues: {
      sql: savedQuery?.sql || "",
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
  const canSaveQueries = datasource
    ? permissionsUtil.canCreateSavedQueries(datasource)
    : null;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const hasEventName = usesEventName(form.watch("sql"));
  const hasValueCol = usesValueColumn(form.watch("sql"));

  // Check if query has been run successfully
  const hasValidResults =
    testQueryResults && !testQueryResults.error && testQueryResults.results;
  const canShowSaveButton =
    canSaveQueries && hasValidResults && form.watch("sql").trim();

  const runTestQuery = useCallback(
    async (sql: string) => {
      setTestQueryResults(null);
      validateSQL(sql, []);
      const res: TestQueryResults = await apiCall("/query/run", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: selectedDatasourceId,
          limit: 1000,
        }),
      });
      return res;
    },
    [apiCall, selectedDatasourceId]
  );

  const handleQuery = useCallback(async () => {
    setTestingQuery(true);
    try {
      const res = await runTestQuery(form.watch("sql"));
      setTestQueryResults({ ...res, error: res.error ? res.error : "" });
    } catch (e) {
      setTestQueryResults({
        sql: form.watch("sql"),
        error: e.message,
        results: [],
      });
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

  // Filter datasources to only those that support SQL queries
  const validDatasources = datasources.filter(
    (d) => d.type !== "google_analytics"
  );

  function handleDownload(results: TestQueryRow[]) {
    //MKTODO: Add error state rather than alert (just waiting for design to be finalized)
    if (!results.length) {
      alert("No data to export.");
      return;
    }
    const csv = convertToCSV(results);
    if (!csv) {
      alert("No data to export.");
      return;
    }
    downloadCSVFile(csv);
  }

  // Pre-fill results if we're editing a saved query with existing results
  useEffect(() => {
    if (savedQuery?.results && savedQuery.results.length > 0) {
      setTestQueryResults({
        results: savedQuery.results,
        sql: savedQuery.sql,
      });
    }
  }, [savedQuery]);

  useEffect(() => {
    // Only clear SQL when the datasource actually changes (not on initial load)
    if (
      previousDatasourceId.current !== selectedDatasourceId &&
      previousDatasourceId.current
    ) {
      form.setValue("sql", "");
      setTestQueryResults(null);
    }
    previousDatasourceId.current = selectedDatasourceId;
  }, [selectedDatasourceId, form]);

  return (
    <>
      {showSaveQueryModal && (
        <SaveQueryModal
          close={() => setShowSaveQueryModal(false)}
          sql={testQueryResults?.sql || ""}
          datasourceId={selectedDatasourceId}
          results={testQueryResults?.results || []}
          onSave={() => {
            setShowSaveQueryModal(false);
            mutate();
          }}
        />
      )}

      <PagedModal
        trackingEventModalType="sql-explorer"
        header="SQL Explorer"
        close={close}
        navStyle="default"
        size="max"
        includeCloseCta={step === 0 ? true : false}
        bodyClassName="p-0"
        cta={step === 0 ? "Next" : "Close"}
        step={step}
        setStep={setStep}
        ctaEnabled={step === 0 ? !!selectedDatasourceId : true}
        submit={async () => {
          if (step === 0) {
            setStep(1);
          } else {
            close();
          }
        }}
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
                            onClick={handleQuery}
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
                        {canShowSaveButton && (
                          <Tooltip
                            body={
                              !canSaveQueries
                                ? "You do not have permission to save queries"
                                : "Save this query for future use"
                            }
                            shouldDisplay={!canSaveQueries}
                          >
                            <Button
                              color="outline-primary"
                              className="btn-sm ml-2"
                              onClick={() => setShowSaveQueryModal(true)}
                              disabled={!canSaveQueries}
                              type="button"
                            >
                              <span className="pr-2">
                                <FaSave />
                              </span>
                              Save Query
                            </Button>
                          </Tooltip>
                        )}
                        {/* {testQueryResults?.results && ( */}
                        <Button
                          color="outline-primary"
                          className="btn-sm ml-2"
                          onClick={() =>
                            handleDownload(testQueryResults?.results || [])
                          }
                          disabled={!testQueryResults?.results}
                          type="button"
                        >
                          <span className="pr-2">
                            <FaSave />
                          </span>
                          Download Results
                        </Button>
                        {/* )} */}
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
                        <div className="pl-2">
                          <Tooltip body="GrowthBook automatically limits the results to 1000 rows">
                            <Checkbox
                              disabled={true}
                              label="Limit 1000"
                              value={true}
                              setValue={() =>
                                console.log("changing limit is disabled")
                              }
                            />
                          </Tooltip>
                        </div>
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
                                handleQuery();
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
                                handleQuery();
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
                    onCtrlEnter={handleQuery}
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
    </>
  );
}
