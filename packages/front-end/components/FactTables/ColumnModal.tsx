import {
  CreateColumnProps,
  ColumnInterface,
  NumberFormat,
  FactTableInterface,
  UpdateColumnProps,
  FactTableColumnType,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import React, { useState } from "react";
import { canInlineFilterColumn } from "shared/experiments";
import { PiPlus, PiX } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { MAX_METRIC_SLICE_LEVELS } from "shared/constants";
import { differenceInDays } from "date-fns";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import RadixButton from "@/ui/Button";
import Button from "@/components/Button";
import { useUser } from "@/services/UserContext";
import { AppFeatures } from "@/types/app-features";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import track from "@/services/track";

export interface Props {
  factTable: FactTableInterface;
  existing?: ColumnInterface;
  close: () => void;
}

export default function ColumnModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();

  // Feature flag and commercial feature checks for slice analysis
  const isMetricSlicesFeatureEnabled = growthbook?.isOn("metric-slices");
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length,
  );
  const [refreshingTopValues, setRefreshingTopValues] = useState(false);

  const [autoSlicesWarning, setAutoSlicesWarning] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const refreshTopValues = async () => {
    if (!existing) return;

    setRefreshingTopValues(true);
    try {
      await apiCall(
        `/fact-tables/${factTable.id}?forceColumnRefresh=1&dim=${existing.column}`,
        {
          method: "PUT",
          body: JSON.stringify({}),
        },
      );
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
      isAutoSliceColumn: existing?.isAutoSliceColumn || false,
      autoSlices: existing?.autoSlices || [],
    },
  });

  // Check if topValuesDate is stale (older than 7 days) or if topValues are empty
  const isTopValuesStale =
    !existing?.topValues?.length ||
    (existing?.topValuesDate &&
      differenceInDays(new Date(), new Date(existing.topValuesDate)) > 7);

  // Auto-refresh top values when isAutoSliceColumn is checked (set to true) and topValues are stale
  React.useEffect(
    () => {
      const isAutoSliceColumn = form.watch("isAutoSliceColumn");
      const wasAutoSliceColumn = existing?.isAutoSliceColumn;

      // Only trigger if isAutoSliceColumn is being set to true (not already true) and topValues are stale
      if (
        isAutoSliceColumn &&
        !wasAutoSliceColumn &&
        !refreshingTopValues &&
        isTopValuesStale
      ) {
        refreshTopValues();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.watch("isAutoSliceColumn")],
  );

  // Calculate auto slice options combining topValues with current autoSlices
  const topValues = existing?.topValues || [];
  const currentLevels = form.watch("autoSlices") || [];
  const allValues = new Set([...topValues, ...currentLevels]);
  const autoSliceOptions = Array.from(allValues).map((value) => ({
    label: value,
    value: value,
  }));

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
    name: form.watch("name") || form.watch("column"),
    description: form.watch("description") || "",
    numberFormat: form.watch("numberFormat") || "",
    datatype: form.watch("datatype"),
    jsonFields: form.watch("jsonFields"),
    alwaysInlineFilter: form.watch("alwaysInlineFilter"),
    isAutoSliceColumn: form.watch("isAutoSliceColumn"),
    autoSlices: form.watch("autoSlices"),
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
            isAutoSliceColumn: value.isAutoSliceColumn,
            autoSlices: value.autoSlices,
          };

          if (existing.autoSlices !== value.autoSlices) {
            track("auto-slices-changed-for-column");
          }

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
          value={form.watch("numberFormat") || ""}
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

      {isMetricSlicesFeatureEnabled &&
        form.watch("datatype") === "string" &&
        !factTable.userIdTypes.includes(form.watch("column")) &&
        form.watch("column") !== "timestamp" && (
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <div className="d-flex align-items-center mb-3">
              <Checkbox
                value={form.watch("isAutoSliceColumn") ?? false}
                setValue={(v) => form.setValue("isAutoSliceColumn", v === true)}
                label={
                  <>
                    Enable Auto Slices
                    {!hasMetricSlicesFeature ? (
                      <PaidFeatureBadge
                        commercialFeature="metric-slices"
                        premiumText="This is an Enterprise feature"
                        variant="outline"
                        ml="2"
                      />
                    ) : null}
                  </>
                }
                description="Column may be used to automatically slice metrics for analysis"
                disabled={!hasMetricSlicesFeature}
              />
            </div>

            {form.watch("isAutoSliceColumn") && hasMetricSlicesFeature && (
              <div className="mb-2">
                <div className="d-flex justify-content-between mb-1">
                  <label className="form-label mb-0">Slices</label>
                  <RadixButton
                    size="xs"
                    variant="ghost"
                    onClick={refreshTopValues}
                    loading={refreshingTopValues}
                  >
                    Refresh
                  </RadixButton>
                </div>
                {autoSlicesWarning ||
                (form.watch("autoSlices") || [])?.length >
                  MAX_METRIC_SLICE_LEVELS ? (
                  <HelperText status="warning" mb="1">
                    Limit {MAX_METRIC_SLICE_LEVELS + ""} slices
                  </HelperText>
                ) : null}
                <MultiSelectField
                  value={form.watch("autoSlices") || []}
                  onChange={(values) => {
                    if (values.length > MAX_METRIC_SLICE_LEVELS) {
                      values = values.slice(0, MAX_METRIC_SLICE_LEVELS);
                      setAutoSlicesWarning(true);
                      setTimeout(() => {
                        setAutoSlicesWarning(false);
                      }, 3000);
                    }
                    form.setValue("autoSlices", values);
                  }}
                  options={autoSliceOptions}
                  creatable={true}
                />
              </div>
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
            value={form.watch("description") || ""}
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
