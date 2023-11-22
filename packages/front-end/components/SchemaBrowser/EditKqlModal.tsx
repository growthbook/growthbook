import { useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateKQL } from "@/services/datasources";
import CodeTextArea from "../Forms/CodeTextArea";
import Modal from "../Modal";
import { CursorData } from "../Segments/SegmentForm";
import DisplayTestQueryResults from "../Settings/DisplayTestQueryResults";
import Button from "../Button";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditKqlModal.module.scss";

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
  templateVariables?: {
    eventName?: string;
    valueColumn?: string;
  };
}

export default function EditKqlModal({
  value,
  save,
  close,
  requiredColumns,
  placeholder = "",
  datasourceId,
  validateResponseOverride,
  templateVariables,
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

  const validateRequiredColumns = (result: TestQueryRow) => {
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
  };

  const runTestQuery = async (sql: string) => {
    validateKQL(sql, []);
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
  };

  const handleTestQuery = async () => {
    setTestingQuery(true);
    const sql = form.getValues("sql");
    try {
      const res = await runTestQuery(sql);
      setTestQueryResults({ ...res, error: res.error ? res.error : "" });
    } catch (e) {
      setTestQueryResults({ sql: sql, error: e.message });
    }
    setTestingQuery(false);
  };

  const datasource = getDatasourceById(datasourceId);
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;

  return (
    <Modal
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
      cta="Save"
      closeCta="Back"
      secondaryCTA={
        <label>
          <input
            type="checkbox"
            className="form-check-input"
            checked={testQueryBeforeSaving}
            onChange={(e) => setTestQueryBeforeSaving(e.target.checked)}
          />
          Test Query Before Saving
        </label>
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
                  <Button
                    color="primary"
                    className="btn-sm"
                    onClick={handleTestQuery}
                    loading={testingQuery}
                  >
                    <span className="pr-2">
                      <FaPlay />
                    </span>
                    Test Query
                  </Button>
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
