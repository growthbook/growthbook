import { MaterializedColumn } from "back-end/types/datasource";
import { cloneDeep } from "lodash";
import { useForm } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { JSONColumnFields } from "back-end/types/fact-table";
import { factTableColumnTypes } from "back-end/src/routers/fact-table/fact-table.validators";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { PiArrowClockwise, PiSpinner } from "react-icons/pi";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Radix/Button";

interface BaseProps {
  existingColumnNames: string[];
  existingSourceFields: string[];
  onSave: (materializedColumn: MaterializedColumn) => Promise<void>;
  onCancel: () => void;
  refreshColumns: (factTableId: string) => Promise<void>;
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
  refreshColumns,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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

  const localSourceField = form.watch("sourceField");
  const localColumnName = form.watch("columnName");

  const [saveEnabled, disabledMessage] = useMemo(() => {
    if (!localColumnName) return [false, "Must specify a column name"];
    if (existingColumnNames.includes(localColumnName))
      return [false, `The name '${localColumnName}' is already in use`];
    if (!localSourceField) return [false, "Must specify a source field"];
    if (existingSourceFields.includes(localSourceField))
      return [false, `The field '${localSourceField}' is already in use`];
    if (localColumnName === column?.columnName) {
      return [
        false,
        "Cannot modify a column while keeping the same name. Delete the original column and create a replacement",
      ];
    }
    return [true, ""];
  }, [
    localColumnName,
    localSourceField,
    existingColumnNames,
    existingSourceFields,
    column,
  ]);

  const [ftId, contextJsonFields]: [string, JSONColumnFields] = useMemo(() => {
    const clickhouseFactTable = factTables.find(
      (ft) => getDatasourceById(ft.datasource)?.type === "growthbook_clickhouse"
    );
    return [
      clickhouseFactTable?.id || "",
      (clickhouseFactTable?.columns || []).find(
        (col) => col.column === "context_json"
      )?.jsonFields || {},
    ];
  }, [factTables, getDatasourceById]);

  useEffect(() => {
    if (
      Object.prototype.hasOwnProperty.call(contextJsonFields, localSourceField)
    ) {
      form.setValue("datatype", contextJsonFields[localSourceField].datatype);
    }
  }, [contextJsonFields, localSourceField, form]);

  useEffect(() => {
    if (mounted) {
      form.setValue("columnName", localSourceField);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSourceField]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectableColumnTypes = factTableColumnTypes.filter((t) => t !== "");

  return (
    <Modal
      trackingEventModalType={`clickhouse-${mode}-materialized-columns`}
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={`${
        mode.charAt(0).toUpperCase() + mode.slice(1)
      } Materialized Column`}
      cta="Save"
      ctaEnabled={saveEnabled}
      autoFocusSelector="#materialized-column-source-field-input"
      disabledMessage={disabledMessage}
    >
      <SelectField
        id="materialized-column-source-field-input"
        labelClassName="w-100"
        label={
          <Flex justify="between" align="center">
            <Text>Source field</Text>
            <Tooltip
              content={
                ftId
                  ? "Refresh list of fields"
                  : "No Fact Tables found to load from"
              }
            >
              <Button
                size="xs"
                variant="ghost"
                disabled={refreshing || !ftId}
                onClick={async () => {
                  setRefreshing(true);
                  await refreshColumns(ftId);
                  setRefreshing(false);
                }}
              >
                {refreshing ? <PiSpinner /> : <PiArrowClockwise />}
              </Button>
            </Tooltip>
          </Flex>
        }
        placeholder={"Select or enter a key"}
        formatCreateLabel={(fieldName) =>
          fieldName.length > 0
            ? `Use field \`${fieldName}\``
            : "...or enter a field not listed here"
        }
        helpText="The field (key) in the event json to materialize as its own column. Must use only alphanumeric characters and ' ', '_', or '-'"
        value={localSourceField}
        createable
        isClearable
        options={Object.keys(contextJsonFields).map((opt) => ({
          label: opt,
          value: opt,
        }))}
        onChange={(value) => {
          form.setValue("sourceField", value);
        }}
        pattern="^[a-zA-Z0-9 _-]*$"
        forceUndefinedValueToNull
      />
      {localSourceField && (
        <>
          <SelectField
            label="Column type"
            value={form.watch("datatype")}
            options={selectableColumnTypes.map((opt) => ({
              label: opt,
              value: opt,
            }))}
            onChange={(value) => {
              form.setValue(
                "datatype",
                value as MaterializedColumn["datatype"]
              );
            }}
          />
          <Field
            label="Column Name"
            helpText="This named column will be available in metric queries. Must start with a letter or underscore and use only alphanumeric characters and '_'"
            {...form.register("columnName")}
            pattern="^[a-zA-Z_][a-zA-Z0-9_]*"
          />
        </>
      )}
    </Modal>
  );
}
