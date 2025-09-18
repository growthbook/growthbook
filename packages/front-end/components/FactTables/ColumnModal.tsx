import {
  CreateColumnProps,
  ColumnInterface,
  NumberFormat,
  FactTableInterface,
  UpdateColumnProps,
  FactTableColumnType,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { canInlineFilterColumn } from "shared/experiments";
import { PiPlus, PiX } from "react-icons/pi";
import { BsArrowRepeat } from "react-icons/bs";
import { Flex } from "@radix-ui/themes";
import { MAX_METRIC_DIMENSION_LEVELS } from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Checkbox from "@/ui/Checkbox";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";
import HelperText from "@/ui/HelperText";

export interface Props {
  factTable: FactTableInterface;
  existing?: ColumnInterface;
  close: () => void;
}

export default function ColumnModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length,
  );
  const [refreshingTopValues, setRefreshingTopValues] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const refreshTopValues = async () => {
    if (!existing) return;

    setRefreshingTopValues(true);
    try {
      await apiCall(`/fact-tables/${factTable.id}?forceColumnRefresh=1`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      mutateDefinitions();
    } catch (error) {
      console.error("Failed to refresh top values:", error);
    } finally {
      setRefreshingTopValues(false);
    }
  };

  const form = useForm<CreateColumnProps>({
    defaultValues: {
      column: existing?.column || "",
      description: existing?.description || "",
      name: existing?.name || "",
      numberFormat: existing?.numberFormat || "",
      datatype: existing?.datatype || "",
      jsonFields: existing?.jsonFields || {},
      alwaysInlineFilter: existing?.alwaysInlineFilter || false,
      isDimension: existing?.isDimension || false,
      dimensionValues: existing?.dimensionValues || [],
      stableDimensionValues: existing?.stableDimensionValues || [],
      maxDimensionValues:
        existing?.maxDimensionValues || MAX_METRIC_DIMENSION_LEVELS,
    },
  });

  const [newJSONField, setNewJSONField] = useState<{
    adding: boolean;
    key: string;
    value: FactTableColumnType;
  }>({
    adding: false,
    key: "",
    value: "string",
  });

  const closeNewJSONField = () => {
    setNewJSONField((v) => ({ ...v, adding: false, key: "" }));
  };

  const submitNewJSONField = () => {
    if (newJSONField.key) {
      form.setValue("jsonFields", {
        ...form.watch("jsonFields"),
        [newJSONField.key]: { datatype: newJSONField.value },
      });
      closeNewJSONField();
    }
  };

  const updatedColumn: ColumnInterface = {
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...existing,
    column: form.watch("column"),
    name: form.watch("name"),
    description: form.watch("description"),
    numberFormat: form.watch("numberFormat"),
    datatype: form.watch("datatype"),
    jsonFields: form.watch("jsonFields"),
    alwaysInlineFilter: form.watch("alwaysInlineFilter"),
    isDimension: form.watch("isDimension"),
    dimensionValues: form.watch("dimensionValues"),
    stableDimensionValues: form.watch("stableDimensionValues"),
    maxDimensionValues: form.watch("maxDimensionValues"),
    deleted: false,
  };

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      cta={"Save"}
      header={existing ? "Edit Column" : "Add Column"}
      submit={form.handleSubmit(async (value) => {
        if (!value.name) value.name = value.column;

        if (existing) {
          const data: UpdateColumnProps = {
            description: value.description,
            name: value.name,
            numberFormat: value.numberFormat,
            datatype: value.datatype,
            alwaysInlineFilter: value.alwaysInlineFilter,
            isDimension: value.isDimension,
            dimensionValues: value.dimensionValues,
            stableDimensionValues: value.stableDimensionValues,
            maxDimensionValues: value.maxDimensionValues,
          };

          // If the column can no longer be inline filtered
          if (data.alwaysInlineFilter) {
            const updatedFactTable = {
              ...factTable,
              columns: factTable.columns.map((c) =>
                c.column === existing.column ? { ...c, ...data } : c,
              ),
            };
            if (!canInlineFilterColumn(updatedFactTable, existing.column)) {
              data.alwaysInlineFilter = false;
            }
          }

          if (data.datatype === "json") {
            data.jsonFields = value.jsonFields;
          }

          await apiCall(
            `/fact-tables/${factTable.id}/column/${existing.column}`,
            {
              method: "PUT",
              body: JSON.stringify(data),
            },
          );
        } else {
          await apiCall(`/fact-tables/${factTable.id}/column`, {
            method: "POST",
            body: JSON.stringify(value),
          });
        }
        mutateDefinitions();
      })}
    >
      {!existing && (
        <div className="alert alert-warning">
          This should only be used if we did not auto-detect your Fact Table
          columns. Please double check your SQL first before using this form.
        </div>
      )}
      <Field
        label="Column"
        {...form.register("column")}
        disabled={!!existing}
      />
      <SelectField
        label="Data Type"
        value={form.watch("datatype")}
        onChange={(f) => form.setValue("datatype", f as FactTableColumnType)}
        initialOption="Unknown"
        required
        sort={false}
        options={[
          {
            label: "Number",
            value: "number",
          },
          {
            label: "String",
            value: "string",
          },
          {
            label: "Date / Datetime",
            value: "date",
          },
          {
            label: "Boolean",
            value: "boolean",
          },
          {
            label: "JSON",
            value: "json",
          },
          {
            label: "Other",
            value: "other",
          },
        ]}
      />
      {form.watch("datatype") === "number" && (
        <SelectField
          label="Number Format"
          value={form.watch("numberFormat")}
          helpText="Used to properly format numbers in the UI"
          onChange={(f) => form.setValue("numberFormat", f as NumberFormat)}
          options={[
            {
              label: "Plain Number",
              value: "",
            },
            {
              label: "Currency",
              value: "currency",
            },
            {
              label: "Time (seconds)",
              value: "time:seconds",
            },
            {
              label: "Memory (bytes)",
              value: "memory:bytes",
            },
            {
              label: "Memory (kilobytes)",
              value: "memory:kilobytes",
            },
          ]}
        />
      )}
      {form.watch("datatype") === "json" && (
        <div className="mb-3">
          <label>JSON Fields</label>
          {newJSONField.adding ||
          Object.keys(form.watch("jsonFields") || {}).length > 0 ? (
            <div
              style={{ height: "200px", overflowY: "auto" }}
              className="border mb-2"
            >
              <table className="table table-sm appbox gbtable mb-0">
                <thead>
                  <tr>
                    <th style={{ position: "sticky", top: -1 }}>Field</th>
                    <th style={{ position: "sticky", top: -1 }}>Data Type</th>
                    <th style={{ position: "sticky", top: -1 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(form.watch("jsonFields") || {}).map(
                    ([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{value.datatype}</td>
                        <td>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              const newFields = { ...form.watch("jsonFields") };
                              delete newFields[key];
                              form.setValue("jsonFields", newFields);
                            }}
                          >
                            <PiX />
                          </a>
                        </td>
                      </tr>
                    ),
                  )}
                  {newJSONField.adding ? (
                    <tr>
                      <td colSpan={3}>
                        <Flex gap="3" align="center">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Field Key"
                            value={newJSONField.key}
                            onChange={(e) =>
                              setNewJSONField({
                                ...newJSONField,
                                key: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.code === "Enter") {
                                e.preventDefault();
                                submitNewJSONField();
                              } else if (e.code === "Escape") {
                                e.preventDefault();
                                closeNewJSONField();
                              }
                            }}
                            autoFocus
                          />
                          <div style={{ minWidth: 115 }}>
                            <SelectField
                              value={newJSONField.value}
                              onChange={(f) =>
                                setNewJSONField({
                                  ...newJSONField,
                                  value: f as FactTableColumnType,
                                })
                              }
                              sort={false}
                              options={[
                                {
                                  label: "Number",
                                  value: "number",
                                },
                                {
                                  label: "String",
                                  value: "string",
                                },
                                {
                                  label: "Date",
                                  value: "date",
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
                            />
                          </div>
                          <Flex gap="1">
                            <Button
                              onClick={submitNewJSONField}
                              disabled={
                                !newJSONField.key || !newJSONField.value
                              }
                            >
                              Add
                            </Button>
                            <Button
                              color="secondary"
                              onClick={closeNewJSONField}
                            >
                              cancel
                            </Button>
                          </Flex>
                        </Flex>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
          {!newJSONField.adding && (
            <div>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setNewJSONField((v) => ({ ...v, adding: true }));
                }}
              >
                <PiPlus /> Add
              </a>
            </div>
          )}
        </div>
      )}

      <Field
        label="Display Name"
        {...form.register("name")}
        placeholder={form.watch("column")}
      />

      {form.watch("datatype") === "string" &&
        !factTable.userIdTypes.includes(form.watch("column")) &&
        form.watch("column") !== "timestamp" && (
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <Checkbox
              value={form.watch("isDimension") ?? false}
              setValue={(v) => form.setValue("isDimension", v === true)}
              label="Is Dimension"
              description="Column represents a dimension that can be applied to metrics"
              mb="3"
            />

            {form.watch("isDimension") && (
              <>
                <Field
                  label="Max Dimension Levels"
                  type="number"
                  min="1"
                  max="50"
                  value={form.watch("maxDimensionValues") || ""}
                  onChange={(e) =>
                    form.setValue(
                      "maxDimensionValues",
                      e.target.value ? parseInt(e.target.value) : undefined,
                    )
                  }
                  placeholder="10"
                  helpText={`Up to ${form.watch("maxDimensionValues")} distinct values will be used as metric dimension levels. You may choose stable values below, and the system will automatically populate the rest using the top values.`}
                />

                <MultiSelectField
                  label="Stable Values"
                  value={form.watch("stableDimensionValues") || []}
                  onChange={(values) =>
                    form.setValue("stableDimensionValues", values)
                  }
                  options={
                    existing?.topValues?.map((value) => ({
                      label: value,
                      value: value,
                    })) || []
                  }
                  creatable={true}
                  placeholder="Add stable dimension values..."
                  helpText="Will always be analyzed as dimension levels."
                />

                {existing && (
                  <div className="mb-3">
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <label className="text-muted mb-0">
                        Top Values (past 7 days)
                      </label>
                      {existing.isDimension && (
                        <RadixButton
                          size="xs"
                          variant="ghost"
                          onClick={refreshTopValues}
                          loading={refreshingTopValues}
                          style={{ width: 70 }}
                        >
                          <BsArrowRepeat style={{ marginTop: -1 }} /> Refresh
                        </RadixButton>
                      )}
                    </div>

                    {existing.topValues && existing.topValues.length > 0 ? (
                      <div
                        className="border rounded px-2 py-1"
                        style={{ fontSize: "0.9em" }}
                      >
                        <div className="d-flex flex-wrap" style={{ gap: 6 }}>
                          {existing.topValues.map((value, index) => {
                            const isInStableValues = (
                              form.watch("stableDimensionValues") || []
                            ).includes(value);
                            return (
                              <div key={index}>
                                <code
                                  style={{
                                    fontSize: "0.8em",
                                    cursor: "pointer",
                                    backgroundColor: isInStableValues
                                      ? "#e3f2fd"
                                      : "#f8f9fa",
                                    padding: "2px 4px",
                                    borderRadius: "3px",
                                    border: isInStableValues
                                      ? "1px solid #2196f3"
                                      : "1px solid #e9ecef",
                                  }}
                                  onClick={() => {
                                    const currentStableValues =
                                      form.watch("stableDimensionValues") || [];
                                    if (isInStableValues) {
                                      // Remove from stable values
                                      form.setValue(
                                        "stableDimensionValues",
                                        currentStableValues.filter(
                                          (v) => v !== value,
                                        ),
                                      );
                                    } else {
                                      // Add to stable values
                                      form.setValue("stableDimensionValues", [
                                        ...currentStableValues,
                                        value,
                                      ]);
                                    }
                                  }}
                                  title={
                                    isInStableValues
                                      ? "Click to remove from stable values"
                                      : "Click to add to stable values"
                                  }
                                >
                                  {value}
                                </code>
                                {index <
                                  (existing?.topValues?.length || 0) - 1 && (
                                  <span>, </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {existing.topValuesDate && (
                          <small className="d-block text-muted text-right mt-1">
                            Last updated:{" "}
                            {new Date(existing.topValuesDate).toLocaleString()}
                          </small>
                        )}
                      </div>
                    ) : (
                      <HelperText status="info" size="sm">
                        Top values were not found for this column.
                      </HelperText>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

      {canInlineFilterColumn(
        {
          ...factTable,
          columns: [updatedColumn],
        },
        form.watch("column"),
      ) && (
        <div className="px-3 pb-1 mb-4">
          <Checkbox
            value={form.watch("alwaysInlineFilter") ?? false}
            setValue={(v) => form.setValue("alwaysInlineFilter", v === true)}
            label="Prompt all metrics to filter on this column"
            description="Use this for columns that are almost always required, like 'event_type' for an `events` table"
          />
        </div>
      )}

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
    </Modal>
  );
}
