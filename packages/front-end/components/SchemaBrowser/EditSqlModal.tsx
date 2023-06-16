import { ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import clsx from "clsx";
import { UserIdType } from "@/../back-end/types/datasource";
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
  requiredColumns: Set<string>;
  placeholder?: string;
  queryType?: "segment" | "dimension" | "metric" | "experiment-assignment";
  setDimensions?: (dimensions: string[]) => void;
  setHasNameCols?: (hasNameCols: boolean) => void;
  identityTypes?: UserIdType[];
  userEnteredHasNameCol?: boolean;
  userEnteredDimensions?: string[];
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
  placeholder = "",
  datasourceId,
  queryType,
  identityTypes,
  setHasNameCols,
  setDimensions,
  userEnteredDimensions = [],
  userEnteredHasNameCol,
}: Props) {
  const [suggestions, setSuggestions] = useState<ReactElement[]>([]);
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

  // We do some one-off logic for Experiment Assignment queries
  useEffect(() => {
    if (
      queryType === "experiment-assignment" &&
      setHasNameCols &&
      setDimensions
    ) {
      const result = testQueryResults?.results?.[0];
      if (!result) return;

      const suggestions: ReactElement[] = [];

      const namedCols = ["experiment_name", "variation_name"];
      const userIdTypes = identityTypes?.map((type) => type.userIdType || []);

      const returnedColumns = new Set<string>(Object.keys(result));
      const optionalColumns = [...returnedColumns].filter(
        (col) =>
          !requiredColumns.has(col) &&
          !namedCols.includes(col) &&
          !userIdTypes?.includes(col)
      );

      // Check if `hasNameCol` should be enabled
      if (!userEnteredHasNameCol) {
        // Selected both required columns, turn on `hasNameCol` automatically
        if (
          returnedColumns.has("experiment_name") &&
          returnedColumns.has("variation_name")
        ) {
          setHasNameCols(true);
        }
        // Only selected `experiment_name`, add warning
        else if (returnedColumns.has("experiment_name")) {
          suggestions.push(
            <>
              Add <code>variation_name</code> to your SELECT clause to enable
              GrowthBook to populate names automatically.
            </>
          );
        }
        // Only selected `variation_name`, add warning
        else if (returnedColumns.has("variation_name")) {
          suggestions.push(
            <>
              Add <code>experiment_name</code> to your SELECT clause to enable
              GrowthBook to populate names automatically.
            </>
          );
        }
      }

      // Prompt to add optional columns as dimensions
      if (optionalColumns.length > 0) {
        suggestions.push(
          <>
            The following columns were returned, but will be ignored. Add them
            as dimensions or disregard this message.
            <ul className="mb-0 pb-0">
              {optionalColumns.map((col) => (
                <li key={col}>
                  <code>{col}</code> -{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setDimensions([...userEnteredDimensions, col]);
                    }}
                  >
                    add as dimension
                  </a>
                </li>
              ))}
            </ul>
          </>
        );
      }

      setSuggestions(suggestions);
    }
  }, [
    requiredColumns,
    testQueryResults,
    form,
    queryType,
    userEnteredHasNameCol,
    userEnteredDimensions,
    identityTypes,
    setHasNameCols,
    setDimensions,
  ]);

  const handleTestQuery = async () => {
    const sql = form.getValues("sql");
    setTestQueryResults(null);
    try {
      validateSQL(sql, []);
      setTestingQuery(true);
      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: datasourceId,
        }),
      });

      setTestQueryResults(res);
    } catch (e) {
      setTestQueryResults({ error: e.message });
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
        await save(value.sql);
      })}
      close={close}
      size="max"
      bodyClassName="p-0"
      cta="Save"
      closeCta="Back"
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
              />
            </div>
            {testQueryResults && (
              <div className="" style={{ flex: 1 }}>
                <DisplayTestQueryResults
                  duration={parseInt(testQueryResults.duration || "0")}
                  requiredColumns={[...requiredColumns]}
                  results={testQueryResults.results || []}
                  error={testQueryResults.error}
                  sql={testQueryResults.sql || ""}
                  suggestions={suggestions}
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
