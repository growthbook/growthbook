import {
  ColumnInterface,
  FactFilterTestResults,
  FactTableColumnType,
  FactTableInterface,
} from "shared/types/fact-table";
import { useForm } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
import { PiPlay } from "react-icons/pi";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FactTableSchema from "./FactTableSchema";

export interface Props {
  factTable: FactTableInterface;
  existing?: ColumnInterface;
  close: () => void;
}

interface FormValues {
  name: string;
  description: string;
  datatype: FactTableColumnType;
  sql: string;
}

// The <slug>_vc suffix keeps virtual column ids in their own namespace so they
// can never collide with a column detected from the fact table SQL.
function toColumnId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `${slug}_vc` : "";
}

export default function VirtualColumnModal({
  existing,
  factTable,
  close,
}: Props) {
  const { apiCall } = useAuth();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length,
  );

  const [testResult, setTestResult] = useState<null | FactFilterTestResults>(
    null,
  );

  const [testBeforeSave, setTestBeforeSave] = useState(true);

  const [showExamples, setShowExamples] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const form = useForm<FormValues>({
    defaultValues: {
      description: existing?.description || "",
      name: existing?.name || "",
      datatype: existing?.datatype || "number",
      sql: existing?.sql || "",
    },
  });

  const isNew = !existing;
  useEffect(() => {
    track(
      isNew
        ? "View Create Virtual Column Modal"
        : "View Edit Virtual Column Modal",
    );
  }, [isNew]);

  // The id used both as the saved column key and the SELECT alias in the test
  // preview: the existing id when editing, or one derived from the name for a
  // new column.
  const columnId = existing?.column || toColumnId(form.watch("name"));

  const testQuery = async (sql: string) => {
    setTestResult(null);
    const result = await apiCall<{
      result: FactFilterTestResults;
    }>(`/fact-tables/${factTable.id}/test-virtual-column`, {
      method: "POST",
      body: JSON.stringify({
        sql,
        datatype: form.watch("datatype"),
        columnId,
      }),
    });
    setTestResult(result.result);
    return result.result;
  };

  // Ref to the SQL textarea so clicking a column inserts it at the cursor.
  const sqlRef = useRef<HTMLTextAreaElement | null>(null);
  const { ref: registerSqlRef, ...sqlField } = form.register("sql");

  const insertColumn = (column: string) => {
    const el = sqlRef.current;
    const current = form.watch("sql");
    if (el && typeof el.selectionStart === "number") {
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      form.setValue(
        "sql",
        current.slice(0, start) + column + current.slice(end),
      );
      // Restore focus and place the cursor just after the inserted text.
      window.requestAnimationFrame(() => {
        el.focus();
        const pos = start + column.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      form.setValue("sql", current ? `${current} ${column}` : column);
    }
  };

  const hasReferenceableColumns = factTable.columns?.some(
    (col) => !col.deleted && col.column !== existing?.column,
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      cta={"Save"}
      size="lg"
      header={existing ? "Edit Virtual Column" : "Add Virtual Column"}
      submit={form.handleSubmit(async (value) => {
        value.sql = value.sql.trim();

        if (!value.name.trim()) {
          throw new Error("Name is required");
        }
        if (!value.sql) {
          throw new Error("Cannot leave the SQL expression blank");
        }
        if (!value.datatype) {
          throw new Error("Please choose a data type");
        }

        if (testBeforeSave) {
          const result = await testQuery(value.sql);
          if (result.error) {
            throw new Error("Fix errors before saving");
          }
        }

        if (existing) {
          await apiCall(
            `/fact-tables/${factTable.id}/column/${existing.column}`,
            {
              method: "PUT",
              body: JSON.stringify({
                name: value.name,
                description: value.description,
                datatype: value.datatype,
                sql: value.sql,
              }),
            },
          );
          track("Edit Virtual Column");
        } else {
          if (!columnId) {
            throw new Error(
              "Please enter a name with at least one letter or number",
            );
          }
          await apiCall(`/fact-tables/${factTable.id}/virtual-column`, {
            method: "POST",
            body: JSON.stringify({
              column: columnId,
              name: value.name,
              description: value.description,
              datatype: value.datatype,
              sql: value.sql,
            }),
          });
          track("Create Virtual Column");
        }
        mutateDefinitions();
      })}
      secondaryAction={
        <Checkbox
          value={testBeforeSave}
          setValue={(v) => setTestBeforeSave(v === true)}
          label="Test before saving"
        />
      }
    >
      <div className="row">
        <div className="col">
          <Field label="Name" {...form.register("name")} required />

          <SelectField
            label="Data Type"
            value={form.watch("datatype")}
            onChange={(v) =>
              form.setValue("datatype", v as FactTableColumnType)
            }
            sort={false}
            helpText="Determines which aggregations and filter operators this column supports"
            options={[
              { label: "Number", value: "number" },
              { label: "String", value: "string" },
              { label: "Date / Datetime", value: "date" },
              { label: "Boolean", value: "boolean" },
            ]}
          />

          {showDescription ? (
            <div className="form-group">
              <label>Description</label>
              <MarkdownInput
                value={form.watch("description")}
                setValue={(value) => form.setValue("description", value)}
                autofocus={!existing?.description?.length}
              />
            </div>
          ) : (
            <a
              href="#"
              className="badge badge-light badge-pill mb-3"
              onClick={(e) => {
                e.preventDefault();
                setShowDescription(true);
              }}
            >
              + description
            </a>
          )}

          <Field
            label="SQL Expression"
            required
            textarea
            minRows={2}
            helpText={
              <>
                This expression is inserted into the SELECT and WHERE clauses
                wherever the column is used. Reference other columns by name.{" "}
                <a
                  href="#"
                  style={{ whiteSpace: "nowrap" }}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowExamples(!showExamples);
                  }}
                >
                  {showExamples ? "Hide" : "Show"} examples{" "}
                  {showExamples ? <FaAngleDown /> : <FaAngleRight />}
                </a>
              </>
            }
            {...sqlField}
            ref={(el: HTMLTextAreaElement | null) => {
              registerSqlRef(el);
              sqlRef.current = el;
            }}
          />

          {showExamples && (
            <Callout status="info">
              <div className="mb-2">
                Here are some examples of SQL expressions:
              </div>
              <table className="table gbtable">
                <tbody>
                  <tr>
                    <td>
                      <InlineCode code={`amount * qty`} language="sql" />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <InlineCode code={`LOWER(country)`} language="sql" />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <InlineCode
                        code={`CASE WHEN amount > 100 THEN 'high' ELSE 'low' END`}
                        language="sql"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </Callout>
          )}

          <Button
            variant="solid"
            size="sm"
            icon={<PiPlay />}
            onClick={async () => {
              await testQuery(form.watch("sql"));
            }}
          >
            Test Query
          </Button>
        </div>
        {hasReferenceableColumns ? (
          <div className="col-auto border-left">
            <div className="mb-3">
              <label>Available Columns</label>
              <FactTableSchema
                factTable={factTable}
                onColumnClick={insertColumn}
                excludeColumn={existing?.column}
              />
            </div>
          </div>
        ) : null}
      </div>
      {testResult ? (
        <div className="border-top mt-3 pt-2">
          <DisplayTestQueryResults
            duration={testResult.duration || 0}
            results={testResult.results || []}
            sql={testResult.sql || ""}
            error={testResult.error || ""}
            close={() => setTestResult(null)}
            expandable={true}
          />
        </div>
      ) : null}
    </ModalStandard>
  );
}
