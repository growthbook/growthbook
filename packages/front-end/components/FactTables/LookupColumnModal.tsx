import {
  ColumnInterface,
  ColumnLookup,
  FactTableColumnType,
  FactTableInterface,
  LookupSourceTestResults,
} from "shared/types/fact-table";
import { getSelectedColumnDatatype } from "shared/experiments";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { PiPlay } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import useSchemaFormOptions from "@/hooks/useSchemaFormOptions";

export interface Props {
  factTable: FactTableInterface;
  existing?: ColumnInterface;
  close: () => void;
}

type SourceType = ColumnLookup["type"];

interface FormValues {
  name: string;
  sourceType: SourceType;
  factTableId: string;
  sql: string;
  table: string;
  localKey: string;
  remoteKey: string;
  remoteColumn: string;
}

// Same `_vc` namespace as virtual columns (a lookup is a virtual column).
function toColumnId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `${slug}_vc` : "";
}

// Keeps a saved value selectable before an inline query has been re-tested.
function columnOptions(
  columns: { column: string; name?: string }[],
  current: string,
) {
  const options = columns.map((c) => ({
    label: c.name && c.name !== c.column ? `${c.name} (${c.column})` : c.column,
    value: c.column,
  }));
  if (current && !options.some((o) => o.value === current)) {
    options.push({ label: current, value: current });
  }
  return options;
}

export default function LookupColumnModal({
  existing,
  factTable,
  close,
}: Props) {
  const { apiCall } = useAuth();
  const { factTables, getFactTableById, getDatasourceById, mutateDefinitions } =
    useDefinitions();
  const { tableOptions } = useSchemaFormOptions(
    getDatasourceById(factTable.datasource),
  );

  const lookup = existing?.lookup;
  const form = useForm<FormValues>({
    defaultValues: {
      name: existing?.name || "",
      sourceType: lookup?.type || "factTable",
      factTableId: lookup?.type === "factTable" ? lookup.factTableId : "",
      sql: lookup?.type === "sql" ? lookup.sql : "",
      table: lookup?.type === "table" ? lookup.table : "",
      localKey: existing?.lookup?.localKey || "",
      remoteKey: existing?.lookup?.remoteKey || "",
      remoteColumn: existing?.lookup?.remoteColumn || "",
    },
  });

  const [testResult, setTestResult] = useState<LookupSourceTestResults | null>(
    null,
  );

  const sourceType = form.watch("sourceType");
  const source =
    sourceType === "factTable"
      ? getFactTableById(form.watch("factTableId"))
      : null;

  const localColumns = factTable.columns.filter((c) => !c.deleted && !c.lookup);
  const remoteColumns =
    sourceType === "factTable"
      ? (source?.columns || []).filter((c) => !c.deleted && !c.lookup)
      : testResult?.columns || [];

  // Another Fact Table on the same Data Source.
  const sourceOptions = factTables
    .filter(
      (ft) =>
        ft.id !== factTable.id &&
        ft.datasource === factTable.datasource &&
        !ft.archived,
    )
    .map((ft) => ({ label: ft.name, value: ft.id }));

  // Runs a SQL or table source to list its columns and their types.
  const testSource = async (
    source: { type: "sql"; sql: string } | { type: "table"; table: string },
  ) => {
    setTestResult(null);
    const res = await apiCall<{ result: LookupSourceTestResults }>(
      `/fact-tables/${factTable.id}/test-lookup-source`,
      { method: "POST", body: JSON.stringify(source) },
    );
    setTestResult(res.result);
    return res.result;
  };

  const columnId = existing?.column || toColumnId(form.watch("name"));

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      cta="Save"
      size="lg"
      header={existing ? "Edit Lookup Column" : "Add Lookup Column"}
      submit={form.handleSubmit(async (value) => {
        if (!value.name.trim()) {
          throw new Error("Name is required");
        }
        if (!value.localKey || !value.remoteKey || !value.remoteColumn) {
          throw new Error("Choose the keys and the column to look up");
        }

        const keys = {
          localKey: value.localKey,
          remoteKey: value.remoteKey,
          remoteColumn: value.remoteColumn,
        };
        let datatype: FactTableColumnType | undefined;
        let lookup: ColumnLookup;
        if (value.sourceType === "factTable") {
          if (!source) throw new Error("Choose a Fact Table to look up");
          datatype = getSelectedColumnDatatype({
            factTable: source,
            column: value.remoteColumn,
          });
          lookup = {
            type: "factTable",
            factTableId: value.factTableId,
            ...keys,
          };
        } else {
          const querySource =
            value.sourceType === "table"
              ? { type: "table" as const, table: value.table.trim() }
              : { type: "sql" as const, sql: value.sql.trim() };
          if (querySource.type === "table" && !querySource.table) {
            throw new Error("Choose a table to look up");
          }
          if (querySource.type === "sql" && !querySource.sql) {
            throw new Error("SQL is required");
          }
          // The source's columns (and the remote column's type) come from
          // running it; re-run so an edit can't save a stale type.
          const result = await testSource(querySource);
          if (result.error) throw new Error("Fix errors before saving");
          datatype = result.columns?.find(
            (c) => c.column === value.remoteColumn,
          )?.datatype;
          if (!datatype) {
            throw new Error(
              `The source doesn't return a column named "${value.remoteColumn}"`,
            );
          }
          lookup = { ...querySource, ...keys };
        }

        if (existing) {
          await apiCall(
            `/fact-tables/${factTable.id}/column/${existing.column}`,
            {
              method: "PUT",
              body: JSON.stringify({ name: value.name, datatype, lookup }),
            },
          );
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
              datatype: datatype || "string",
              lookup,
            }),
          });
        }
        mutateDefinitions();
      })}
    >
      <Callout status="info" mb="3">
        A lookup column filters rows by a value from another table, e.g. events
        from users whose plan is &quot;pro&quot;. It can only be used in row
        filters.
      </Callout>

      <Field label="Name" {...form.register("name")} required />

      <SelectField
        label="Look up from"
        value={sourceType}
        onChange={(v) => {
          form.setValue("sourceType", v as SourceType);
          setTestResult(null);
          form.setValue("remoteKey", "");
          form.setValue("remoteColumn", "");
        }}
        sort={false}
        options={[
          { label: "Another Fact Table", value: "factTable" },
          { label: "A table", value: "table" },
          { label: "SQL query", value: "sql" },
        ]}
      />

      {sourceType === "factTable" ? (
        <SelectField
          label="Fact Table"
          value={form.watch("factTableId")}
          onChange={(v) => {
            form.setValue("factTableId", v);
            form.setValue("remoteKey", "");
            form.setValue("remoteColumn", "");
          }}
          options={sourceOptions}
          helpText="Must be on the same Data Source"
          required
        />
      ) : sourceType === "table" ? (
        <>
          <SelectField
            label="Table"
            value={form.watch("table")}
            onChange={async (v) => {
              form.setValue("table", v);
              form.setValue("remoteKey", "");
              form.setValue("remoteColumn", "");
              // Load its columns right away for the key pickers.
              if (v) await testSource({ type: "table", table: v });
            }}
            options={tableOptions}
            createable
            keepCreatableWhenEmpty
            formatCreateLabel={(v) => `Use table "${v}"`}
            placeholder="Choose or type a table name"
            helpText="Looks up SELECT * FROM this table"
            required
          />
          {testResult?.error ? (
            <Callout status="error" mb="3">
              {testResult.error}
            </Callout>
          ) : null}
        </>
      ) : (
        <>
          <Field
            label="SQL"
            textarea
            minRows={4}
            required
            helpText="A query returning the key and the column to look up. Template variables like {{startDate}} work here."
            {...form.register("sql")}
          />
          <Button
            variant="solid"
            size="md"
            icon={<PiPlay />}
            onClick={async () => {
              await testSource({ type: "sql", sql: form.watch("sql") });
            }}
            mb="3"
          >
            Test query
          </Button>
          {testResult?.error ? (
            <Callout status="error" mb="3">
              {testResult.error}
            </Callout>
          ) : null}
        </>
      )}

      <SelectField
        label="Key on this Fact Table"
        value={form.watch("localKey")}
        onChange={(v) => form.setValue("localKey", v)}
        options={columnOptions(localColumns, form.watch("localKey"))}
        required
      />
      <SelectField
        label="Matching key in the source"
        value={form.watch("remoteKey")}
        onChange={(v) => form.setValue("remoteKey", v)}
        options={columnOptions(remoteColumns, form.watch("remoteKey"))}
        helpText={
          sourceType !== "factTable" && !testResult?.columns
            ? "Test the source to list its columns"
            : undefined
        }
        required
      />
      <SelectField
        label="Column to filter on"
        value={form.watch("remoteColumn")}
        onChange={(v) => form.setValue("remoteColumn", v)}
        options={columnOptions(remoteColumns, form.watch("remoteColumn"))}
        required
      />
    </ModalStandard>
  );
}
