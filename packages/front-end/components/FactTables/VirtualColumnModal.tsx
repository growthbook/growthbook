import {
  ColumnInterface,
  FactFilterTestResults,
  FactTableColumnType,
  FactTableInterface,
} from "shared/types/fact-table";
import { useForm } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { FaPlay } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Button";
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

// vc_<slug> keeps virtual column ids in their own namespace so they can never
// collide with a column detected from the fact table SQL.
function toColumnId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `vc_${slug}` : "";
}

function operatorsForDatatype(datatype: FactTableColumnType): string[] {
  switch (datatype) {
    case "number":
      return ["+", "-", "*", "/"];
    case "string":
      return ["||"];
    case "date":
      return ["-"];
    default:
      return [];
  }
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

  // Guided expression builder state
  const [builderColA, setBuilderColA] = useState("");
  const [builderOp, setBuilderOp] = useState("");
  const [builderColB, setBuilderColB] = useState("");

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

  // Columns that can be referenced: any non-deleted column other than the one
  // being edited (a virtual column can reference other virtual columns too).
  const availableColumns = useMemo(
    () =>
      (factTable.columns || []).filter(
        (c) => !c.deleted && c.column !== existing?.column,
      ),
    [factTable.columns, existing?.column],
  );
  const columnByName = useMemo(
    () => new Map(availableColumns.map((c) => [c.column, c])),
    [availableColumns],
  );

  const builderColADatatype = builderColA
    ? columnByName.get(builderColA)?.datatype
    : undefined;
  const builderOperators = builderColADatatype
    ? operatorsForDatatype(builderColADatatype)
    : [];

  const testQuery = async (sql: string) => {
    setTestResult(null);
    const result = await apiCall<{
      result: FactFilterTestResults;
    }>(`/fact-tables/${factTable.id}/test-virtual-column`, {
      method: "POST",
      body: JSON.stringify({ sql, datatype: form.watch("datatype") }),
    });
    setTestResult(result.result);
    return result.result;
  };

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
          const columnId = toColumnId(value.name);
          if (!columnId) {
            throw new Error(
              "Please enter a name with at least one letter or number",
            );
          }
          await apiCall(`/fact-tables/${factTable.id}/column`, {
            method: "POST",
            body: JSON.stringify({
              column: columnId,
              name: value.name,
              description: value.description,
              datatype: value.datatype,
              sql: value.sql,
              isVirtual: true,
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
            minRows={1}
            helpText="This expression is inserted into the SELECT and WHERE clauses wherever the column is used. Reference other columns by name."
            {...form.register("sql")}
          />

          <Callout status="info">
            <div className="mb-2">Build an expression from two columns:</div>
            <div className="d-flex align-items-end" style={{ gap: 8 }}>
              <SelectField
                label="Column"
                value={builderColA}
                onChange={(v) => {
                  setBuilderColA(v);
                  setBuilderOp("");
                  setBuilderColB("");
                }}
                options={availableColumns.map((c) => ({
                  label: c.name || c.column,
                  value: c.column,
                }))}
                style={{ minWidth: 140 }}
              />
              <SelectField
                label="Operator"
                value={builderOp}
                onChange={setBuilderOp}
                disabled={!builderColA}
                sort={false}
                options={builderOperators.map((o) => ({
                  label: o,
                  value: o,
                }))}
                style={{ minWidth: 90 }}
              />
              <SelectField
                label="Column"
                value={builderColB}
                onChange={setBuilderColB}
                disabled={!builderColA}
                options={availableColumns
                  .filter((c) => c.datatype === builderColADatatype)
                  .map((c) => ({
                    label: c.name || c.column,
                    value: c.column,
                  }))}
                style={{ minWidth: 140 }}
              />
              <Button
                color="outline-primary"
                className="mb-3"
                disabled={!builderColA || !builderOp || !builderColB}
                onClick={async () => {
                  const snippet = `${builderColA} ${builderOp} ${builderColB}`;
                  const current = form.watch("sql");
                  form.setValue(
                    "sql",
                    current ? `${current} ${snippet}` : snippet,
                  );
                }}
              >
                Insert
              </Button>
            </div>
          </Callout>

          <Button
            color="primary"
            className="btn-sm mr-4"
            onClick={async () => {
              await testQuery(form.watch("sql"));
            }}
          >
            <span className="pr-2">
              <FaPlay />
            </span>
            Test Query
          </Button>
        </div>
        {factTable.columns?.some((col) => !col.deleted && !col.isVirtual) ? (
          <div className="col-auto border-left">
            <div className="mb-3">
              <label>Available Columns</label>
              <FactTableSchema factTable={factTable} />
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
