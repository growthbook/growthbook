import { MaterializedColumn } from "back-end/types/datasource";
import { cloneDeep } from "lodash";
import { useForm } from "react-hook-form";
import { useEffect, useMemo } from "react";
import { JSONColumnFields } from "back-end/types/fact-table";
import { factTableColumnTypes } from "back-end/src/routers/fact-table/fact-table.validators";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";

interface BaseProps {
  existingColumnNames: string[];
  existingSourceFields: string[];
  onSave: (materializedColumn: MaterializedColumn) => Promise<void>;
  onCancel: () => void;
}

interface AddProps extends BaseProps {
  mode: "add";
  column: undefined;
}

interface EditProps extends BaseProps {
  mode: "edit";
  column: MaterializedColumn;
}

type Props = AddProps | EditProps;

export default function AddMaterializedColumnsModal({
  mode,
  column,
  existingColumnNames,
  existingSourceFields,
  onSave,
  onCancel,
}: Props) {
  const { factTables, getDatasourceById } = useDefinitions();
  const form = useForm<MaterializedColumn>({
    defaultValues:
      mode === "edit" && column
        ? cloneDeep<MaterializedColumn>(column)
        : {
            columnName: "",
            sourceField: "",
            datatype: "string",
          },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      columnName: "",
      sourceField: "",
      datatype: "string",
    });
  });

  const localColumn = form.watch();

  const [saveEnabled, disabledMessage] = useMemo(() => {
    if (!localColumn.columnName) return [false, "Must specify a column name"];
    if (existingColumnNames.includes(localColumn.columnName))
      return [false, `The name '${localColumn.columnName}' is already in use`];
    if (!localColumn.sourceField) return [false, "Must specify a source field"];
    if (existingSourceFields.includes(localColumn.sourceField))
      return [
        false,
        `The field '${localColumn.sourceField}' is already in use`,
      ];

    return [true, ""];
  }, [localColumn, existingColumnNames, existingSourceFields]);

  const contextJsonFields: JSONColumnFields = useMemo(() => {
    const clickhouseFactTables = factTables.filter(
      (ft) => getDatasourceById(ft.datasource)?.type === "growthbook_clickhouse"
    );
    return clickhouseFactTables
      .map(
        (ft) =>
          ft.columns.find((col) => col.column === "context_json")?.jsonFields
      )
      .reduce<JSONColumnFields>((acc, val) => ({ ...acc, ...(val || {}) }), {});
  }, [factTables, getDatasourceById]);

  useEffect(() => {
    if (
      Object.prototype.hasOwnProperty.call(
        contextJsonFields,
        localColumn.sourceField
      )
    ) {
      form.setValue(
        "datatype",
        contextJsonFields[localColumn.sourceField].datatype
      );
    }
  }, [contextJsonFields, localColumn.sourceField, form]);

  const selectableColumnTypes = factTableColumnTypes.filter((t) => t !== "");

  return (
    <Modal
      trackingEventModalType="clickhouse-add-materialized-columns"
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header="Add Materialized Columns"
      cta="Save"
      ctaEnabled={saveEnabled}
      autoFocusSelector="#materialized-column-name-input"
      disabledMessage={disabledMessage}
    >
      <Field
        id="materialized-column-name-input"
        label="Column Name"
        helpText="This named column will be available in metric queries"
        {...form.register("columnName")}
      />
      <SelectField
        label="Source field"
        placeholder={"Select or enter a key"}
        formatCreateLabel={(fieldName) =>
          fieldName.length > 0
            ? `Use field \`${fieldName}\``
            : "...or enter a field not listed here"
        }
        helpText="The field (key) in the event json to materialize as its own column"
        value={localColumn.sourceField}
        createable
        isClearable
        options={Object.keys(contextJsonFields).map((opt) => ({
          label: opt,
          value: opt,
        }))}
        onChange={(value) => {
          form.setValue("sourceField", value);
        }}
      />
      <SelectField
        disabled={mode === "edit"}
        helpText={
          mode === "edit"
            ? "To change the type of a field, delete it and re-create it with the new type"
            : ""
        }
        label="Column type"
        value={form.watch("datatype")}
        options={selectableColumnTypes.map((opt) => ({
          label: opt,
          value: opt,
        }))}
        onChange={(value) => {
          form.setValue("datatype", value as MaterializedColumn["datatype"]);
        }}
      />
    </Modal>
  );
}
