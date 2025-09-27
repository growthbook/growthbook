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
import { MAX_METRIC_DIMENSION_LEVELS } from "shared/constants";
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

  // Feature flag and commercial feature checks for dimension analysis
  const isMetricDimensionsFeatureEnabled =
    growthbook?.isOn("metric-dimensions");
  const hasMetricDimensionsFeature = hasCommercialFeature("metric-dimensions");

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length,
  );
  const [refreshingTopValues, setRefreshingTopValues] = useState(false);

  const [dimensionLevelsWarning, setDimensionLevelsWarning] = useState(false);

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
      isDimension: existing?.isDimension || false,
      dimensionLevels: existing?.dimensionLevels || [],
    },
  });

  // Check if topValuesDate is stale (older than 7 days) or if topValues are empty
  const isTopValuesStale =
    !existing?.topValues?.length ||
    (existing?.topValuesDate &&
      differenceInDays(new Date(), new Date(existing.topValuesDate)) > 7);

  // Auto-refresh top values when isDimension is checked (set to true) and topValues are stale
  React.useEffect(
    () => {
      const isDimension = form.watch("isDimension");
      const wasDimension = existing?.isDimension;

      // Only trigger if isDimension is being set to true (not already true) and topValues are stale
      if (
        isDimension &&
        !wasDimension &&
        !refreshingTopValues &&
        isTopValuesStale
      ) {
        refreshTopValues();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.watch("isDimension")],
  );

  // Calculate dimension level options combining topValues with current dimensionLevels
  const topValues = existing?.topValues || [];
  const currentLevels = form.watch("dimensionLevels") || [];
  const allValues = new Set([...topValues, ...currentLevels]);
  const dimensionLevelOptions = Array.from(allValues).map((value) => ({
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
    isDimension: form.watch("isDimension"),
    dimensionLevels: form.watch("dimensionLevels"),
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
            dimensionLevels: value.dimensionLevels,
          };

          if (existing.dimensionLevels !== value.dimensionLevels) {
            track("dimension-levels-changed-for-column");
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

      {isMetricDimensionsFeatureEnabled &&
        form.watch("datatype") === "string" &&
        !factTable.userIdTypes.includes(form.watch("column")) &&
        form.watch("column") !== "timestamp" && (
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <div className="d-flex align-items-center mb-3">
              <Checkbox
                value={form.watch("isDimension") ?? false}
                setValue={(v) => form.setValue("isDimension", v === true)}
                label={
                  <>
                    Is Dimension
                    {!hasMetricDimensionsFeature ? (
                      <PaidFeatureBadge
                        commercialFeature="metric-dimensions"
                        premiumText="This is an Enterprise feature"
                        variant="outline"
                        ml="2"
                      />
                    ) : null}
                  </>
                }
                description="Column represents a dimension that can be applied to metrics"
                disabled={!hasMetricDimensionsFeature}
              />
            </div>

            {form.watch("isDimension") && hasMetricDimensionsFeature && (
              <div className="mb-2">
                <div className="d-flex justify-content-between mb-1">
                  <label className="form-label mb-0">Dimension Levels</label>
                  <RadixButton
                    size="xs"
                    variant="ghost"
                    onClick={refreshTopValues}
                    loading={refreshingTopValues}
                  >
                    Refresh
                  </RadixButton>
                </div>
                {dimensionLevelsWarning ||
                (form.watch("dimensionLevels") || [])?.length >
                  MAX_METRIC_DIMENSION_LEVELS ? (
                  <HelperText status="warning" mb="1">
                    Limit {MAX_METRIC_DIMENSION_LEVELS + ""} dimension levels
                  </HelperText>
                ) : null}
                <MultiSelectField
                  value={form.watch("dimensionLevels") || []}
                  onChange={(values) => {
                    if (values.length > MAX_METRIC_DIMENSION_LEVELS) {
                      values = values.slice(0, MAX_METRIC_DIMENSION_LEVELS);
                      setDimensionLevelsWarning(true);
                      setTimeout(() => {
                        setDimensionLevelsWarning(false);
                      }, 3000);
                    }
                    form.setValue("dimensionLevels", values);
                  }}
                  options={dimensionLevelOptions}
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
