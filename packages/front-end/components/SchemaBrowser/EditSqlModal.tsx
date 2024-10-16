import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import clsx from "clsx";
import { TemplateVariables } from "back-end/types/sql";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Modal from "@/components/Modal";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Button";
import {
  usesEventName,
  usesValueColumn,
} from "@/components/Metrics/MetricForm";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

export type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

export interface Props {
  value: string;
  datasourceId: string;
  save: (sql: string) => Promise<void>;
  close: () => void;
  requiredColumns: Set<string>;
  placeholder?: string;
  validateResponseOverride?: (response: TestQueryRow) => void;
  setTemplateVariables?: (templateVariables: TemplateVariables) => void;
  templateVariables?: {
    eventName?: string;
    valueColumn?: string;
  };
}

export default function EditSqlModal({
  value,
  save,
  close,
  requiredColumns,
  placeholder = "",
  datasourceId,
  validateResponseOverride,
  templateVariables,
  setTemplateVariables,
}: Props) {
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const [testQueryBeforeSaving, setTestQueryBeforeSaving] = useState(true);
  const form = useForm({
    defaultValues: {
      sql: value,
    },
  });
  const { getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();

  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [testingQuery, setTestingQuery] = useState(false);

  const permissionsUtil = usePermissionsUtil();

  const validateRequiredColumns = useCallback(
    (result: TestQueryRow) => {
      if (!result) return;

      const requiredColumnsArray = Array.from(requiredColumns);
      const missingColumns = requiredColumnsArray.filter(
        (col) => !((col as string) in result)
      );

      if (missingColumns.length > 0) {
        throw new Error(
          `You are missing the following columns: ${missingColumns.join(", ")}`
        );
      }
    },
    // eslint-disable-next-line
    [Array.from(requiredColumns).join("")]
  );

  const runTestQuery = useCallback(
    async (sql: string) => {
      validateSQL(sql, []);
      setTestQueryResults(null);
      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: datasourceId,
          templateVariables: templateVariables,
        }),
      });

      if (res.results?.length) {
        if (validateResponseOverride) {
          validateResponseOverride(res.results[0]);
        } else {
          validateRequiredColumns(res.results[0]);
        }
      }

      return res;
    },
    // eslint-disable-next-line
    [
      apiCall,
      datasourceId,
      validateRequiredColumns,
      validateResponseOverride,
      // eslint-disable-next-line
      JSON.stringify(templateVariables),
    ]
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

  const datasource = getDatasourceById(datasourceId);
  const canRunQueries = datasource
    ? permissionsUtil.canRunTestQueries(datasource)
    : null;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;

  const hasEventName = usesEventName(form.watch("sql"));
  const hasValueCol = usesValueColumn(form.watch("sql"));

  useEffect(() => {
    if (!canRunQueries) setTestQueryBeforeSaving(false);
  }, [canRunQueries]);

  return (
    <Modal
      trackingEventModalType=""
      open
      header="Edit SQL"
      submit={form.handleSubmit(async (value) => {
        if (testQueryBeforeSaving) {
          let res: TestQueryResults;
          try {
            res = await runTestQuery(value.sql);
          } catch (e) {
            setTestQueryResults({ sql: value.sql, error: e.message });
            // Rejecting with a blank error as we handle the error in the
            // DisplayTestQueryResults component rather than in the Modal component
            return Promise.reject(new Error());
          }
          if (res.error) {
            setTestQueryResults(res);
            // Rejecting with a blank error as we handle the error in the
            // DisplayTestQueryResults component rather than in the Modal component
            return Promise.reject(new Error());
          }
        }

        await save(value.sql);
      })}
      close={close}
      size="max"
      overflowAuto={false}
      bodyClassName="p-0"
      cta="Confirm Changes"
      closeCta="Back"
      secondaryCTA={
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
            Test query before confirming
          </label>
        </Tooltip>
      }
    >
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
                </div>
                {Array.from(requiredColumns).length > 0 && (
                  <div className="col-auto ml-auto pr-3">
                    <strong>Required Columns:</strong>
                    {Array.from(requiredColumns).map((col) => (
                      <code className="mx-1 border p-1" key={col}>
                        {col}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {setTemplateVariables && (hasEventName || hasValueCol) && (
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
                setValue={(sql) => form.setValue("sql", sql)}
                placeholder={placeholder}
                helpText={""}
                fullHeight
                setCursorData={setCursorData}
                onCtrlEnter={handleTestQuery}
                resizeDependency={!!testQueryResults}
              />
            </div>
            {testQueryResults && (
              <div className="" style={{ flex: 1, maxHeight: "45%" }}>
                <DisplayTestQueryResults
                  duration={parseInt(testQueryResults.duration || "0")}
                  results={testQueryResults.results || []}
                  sql={testQueryResults.sql || ""}
                  error={testQueryResults.error || ""}
                  close={() => setTestQueryResults(null)}
                />
              </div>
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
    </Modal>
  );
}
