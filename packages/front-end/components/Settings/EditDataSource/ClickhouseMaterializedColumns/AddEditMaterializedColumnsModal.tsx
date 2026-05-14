import { MaterializedColumn } from "shared/types/datasource";
import { cloneDeep } from "lodash";
import { useForm } from "react-hook-form";
import { useMemo, useState } from "react";
import { JSONColumnFields } from "shared/types/fact-table";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { PiArrowClockwise, PiSpinner } from "react-icons/pi";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";

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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { factTables, getDatasourceById } = useDefinitions();
  const form = useForm<MaterializedColumn>({
    defaultValues:
      mode === "edit" && column
        ? cloneDeep<MaterializedColumn>(column)
        : {
            columnName: "",
            sourceField: "",
            datatype: "string",
            type: "",
          },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      columnName: "",
      sourceField: "",
      datatype: "string",
      type: "",
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
    return [true, ""];
  }, [
    localColumnName,
    localSourceField,
    existingColumnNames,
    existingSourceFields,
  ]);

  const [ftId, contextJsonFields]: [string, JSONColumnFields] = useMemo(() => {
    const clickhouseFactTable = factTables.find(
      (ft) =>
        getDatasourceById(ft.datasource)?.type === "growthbook_clickhouse",
    );
    return [
      clickhouseFactTable?.id || "",
      (clickhouseFactTable?.columns || []).find(
        (col) => col.column === "attributes",
      )?.jsonFields || {},
    ];
  }, [factTables, getDatasourceById]);

  const typeOptions = [{ label: "Other", value: "" }];

  const datatype = form.watch("datatype");
  if (["string", "number", "boolean"].includes(datatype)) {
    typeOptions.push({ label: "Dimension", value: "dimension" });
  }
  if (["string", "number"].includes(datatype)) {
    typeOptions.push({ label: "Identifier", value: "identifier" });
  }

  return (
    <Modal
      trackingEventModalType={`clickhouse-${mode}-materialized-columns`}
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={`${mode.charAt(0).toUpperCase() + mode.slice(1)} Key Attribute`}
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
            <Text>Attribute</Text>
            <div>
              <span className="text-danger ml-2">{refreshError}</span>
              <Tooltip
                content={
                  ftId
                    ? "Refresh list of attributes"
                    : "No Fact Tables found to load from"
                }
              >
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={refreshing || !ftId}
                  onClick={async () => {
                    setRefreshing(true);
                    setRefreshError(null);
                    try {
                      await refreshColumns(ftId);
                    } catch (e) {
                      setRefreshError(e.message);
                    }
                    setRefreshing(false);
                  }}
                >
                  {refreshing ? <PiSpinner /> : <PiArrowClockwise />}
                </Button>
              </Tooltip>
            </div>
          </Flex>
        }
        placeholder={"Select or enter an attribute"}
        formatCreateLabel={(fieldName) =>
          fieldName.length > 0
            ? `Use attribute \`${fieldName}\``
            : "...or enter an attribute not listed here"
        }
        value={localSourceField}
        createable
        isClearable
        options={Object.keys(contextJsonFields).map((opt) => ({
          label: opt,
          value: opt,
        }))}
        onChange={(value) => {
          form.setValue("sourceField", value);
          form.setValue("columnName", value);

          if (contextJsonFields && value in contextJsonFields) {
            let datatype = contextJsonFields[value].datatype;

            if (
              !datatype ||
              !["string", "number", "boolean"].includes(datatype)
            ) {
              datatype = "other";
            }

            form.setValue("datatype", datatype);
            form.setValue("type", "");
          } else {
            form.setValue("type", "");
          }
        }}
        pattern="^[a-zA-Z0-9 _-]*$"
        forceUndefinedValueToNull
      />
      {localSourceField && (
        <>
          <SelectField
            label="Data type"
            value={form.watch("datatype")}
            options={[
              {
                label: "String",
                value: "string",
              },
              {
                label: "Number",
                value: "number",
              },
              {
                label: "Boolean",
                value: "boolean",
              },
              {
                label: "Other",
                value: "other",
              },
            ]}
            onChange={(value) => {
              form.setValue(
                "datatype",
                value as MaterializedColumn["datatype"],
              );
            }}
          />
          <Field
            label="Column Name"
            helpText="The SQL column the attribute will be stored in. Must start with a letter or underscore and use only alphanumeric characters and '_'"
            {...form.register("columnName")}
            pattern="^[a-zA-Z_][a-zA-Z0-9_]*$"
          />
          <SelectField
            label="Treat As"
            value={form.watch("type") || ""}
            options={typeOptions}
            onChange={(value: "" | "identifier" | "dimension") => {
              form.setValue("type", value);
            }}
            helpText={
              <>
                <strong>Identifiers</strong> are your experiment units
                (device_id, user_id, etc). <strong>Dimensions</strong> can be
                used to slice and dice experiment results (account_type,
                country, etc).
              </>
            }
          />
        </>
      )}
    </Modal>
  );
}
