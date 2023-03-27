import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea from "../Forms/CodeTextArea";
import Modal from "../Modal";
import { CursorData } from "../Segments/SegmentForm";
import DisplayTestQueryResults from "../Settings/DisplayTestQueryResults";
import Button from "../Button";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

export interface Props {
  value: string;
  datasourceId: string;
  save: (sql: string) => Promise<void>;
  close: () => void;
  requiredColumns: string[];
  placeholder: string;
}

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

export default function EditSqlModal({
  value,
  save,
  close,
  requiredColumns,
  placeholder,
  datasourceId,
}: Props) {
  const form = useForm({
    defaultValues: {
      sql: value,
    },
  });
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const { getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();

  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [testingQuery, setTestingQuery] = useState(false);

  const handleTestQuery = useCallback(async () => {
    const sql = form.getValues("sql");
    try {
      // Just check for basic SQL syntax, not any required columns
      // We can check for required columns after the results are returned
      validateSQL(sql, []);

      setTestingQuery(true);
      const res = await apiCall<TestQueryResults>("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId,
        }),
      });

      setTestQueryResults(res);
    } catch (e) {
      setTestQueryResults({ error: e.message });
    }
    setTestingQuery(false);
  }, [form, apiCall, datasourceId]);

  const datasource = getDatasourceById(datasourceId);
  const supportsSchemaBrowser = datasource.properties.supportsInformationSchema;

  return (
    <Modal
      open
      header="Edit SQL"
      submit={form.handleSubmit(async (value) => {
        await save(value.sql);
      })}
      close={close}
      size="max"
      bodyClassName="p-0"
      cta="Save"
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
                {requiredColumns.length > 0 && (
                  <div className="col-auto ml-auto pr-3">
                    <strong>Required Columns:</strong>
                    {requiredColumns.map((col) => (
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
              />
            </div>
            {testQueryResults && (
              <div className="" style={{ flex: 1 }}>
                <DisplayTestQueryResults
                  duration={parseInt(testQueryResults.duration || "0")}
                  requiredColumns={[...requiredColumns]}
                  results={testQueryResults.results}
                  error={testQueryResults.error}
                  sql={testQueryResults.sql}
                  suggestions={[]}
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
              cursorData={cursorData}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
