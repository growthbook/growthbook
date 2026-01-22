import {
  CreateColumnProps,
  ColumnInterface,
  NumberFormat,
  FactTableInterface,
  UpdateColumnProps,
  FactTableColumnType,
} from "shared/types/fact-table";
import { useForm } from "react-hook-form";
import React, { useState, useEffect } from "react";
import { canInlineFilterColumn } from "shared/experiments";
import { getValidDate, abbreviateAgo, datetime, ago } from "shared/dates";
import {
  PiPlus,
  PiX,
  PiArrowSquareOut,
  PiArrowClockwise,
  PiLightning,
  PiLightningSlash,
} from "react-icons/pi";
import { Flex, Text } from "@radix-ui/themes";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { differenceInDays } from "date-fns";
import { useGrowthBook } from "@growthbook/growthbook-react";
import Link from "@/ui/Link";
import HelperText from "@/ui/HelperText";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Checkbox from "@/ui/Checkbox";
import RadixButton from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import { useUser } from "@/services/UserContext";
import { AppFeatures } from "@/types/app-features";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import track from "@/services/track";
import { getAutoSliceUpdateFrequencyHours } from "@/services/env";
import { DocLink } from "@/components/DocLink";

export interface Props {
  factTable: FactTableInterface;
  existing?: ColumnInterface;
  close: () => void;
}

export default function ColumnModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature, settings } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();

  // Feature flag and commercial feature checks for slice analysis
  const isMetricSlicesFeatureEnabled = growthbook?.isOn("metric-slices");
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");

  const maxMetricSliceLevels =
    settings?.maxMetricSliceLevels ?? DEFAULT_MAX_METRIC_SLICE_LEVELS;

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length,
  );
  const [refreshingTopValues, setRefreshingTopValues] = useState(false);

  const [autoSlicesWarning, setAutoSlicesWarning] = useState(false);
  const [hasManuallyClearedSlices, setHasManuallyClearedSlices] =
    useState(false);
  const [shouldForceOverwriteSlices, setShouldForceOverwriteSlices] =
    useState(false);
  const [newSliceValue, setNewSliceValue] = useState("");
  const [showAddSliceInput, setShowAddSliceInput] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const refreshTopValues = async () => {
    if (!existing) return;

    setRefreshingTopValues(true);
    setShouldForceOverwriteSlices(true); // Flag to force overwrite slices
    try {
      await apiCall(
        `/fact-tables/${factTable.id}/column/${existing.column}/top-values`,
        {
          method: "POST",
        },
      );
      mutateDefinitions();
      // Reset manual clear flag so auto-population can work again after refresh
      setHasManuallyClearedSlices(false);
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
      lockedAutoSlices: existing?.lockedAutoSlices || [],
    },
  });

  const topValues = existing?.topValues || [];
  const isTopValuesStale =
    !existing?.topValues?.length ||
    (existing?.topValuesDate &&
      differenceInDays(new Date(), new Date(existing.topValuesDate)) > 7);

  // Auto-refresh top values when isAutoSliceColumn is checked (set to true) and topValues are stale
  useEffect(
    () => {
      // Skip refresh if auto-updates are enabled (scheduled job will handle it)
      if (factTable.autoSliceUpdatesEnabled) {
        return;
      }

      const isAutoSliceColumn = form.watch("isAutoSliceColumn");
      const wasAutoSliceColumn = existing?.isAutoSliceColumn;
      const datatype = form.watch("datatype");

      // Skip refresh for boolean columns
      if (datatype === "boolean") {
        if (isAutoSliceColumn && !wasAutoSliceColumn) {
          form.setValue("autoSlices", ["true", "false"]);
        }
        return;
      }

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

  // Auto-populate autoSlices when top values query finishes and autoSlices is empty
  const isAutoSliceColumn = form.watch("isAutoSliceColumn");
  useEffect(
    () => {
      const currentAutoSlices = form.watch("autoSlices");

      // Force overwrite slices when user clicks "Get Top Values"
      if (
        isAutoSliceColumn &&
        topValues.length > 0 &&
        !refreshingTopValues &&
        shouldForceOverwriteSlices
      ) {
        const newAutoSlices = topValues.slice(0, maxMetricSliceLevels);
        form.setValue("autoSlices", newAutoSlices);
        setShouldForceOverwriteSlices(false); // Reset flag
        return;
      }

      // Only auto-populate if:
      // 1. This is an auto slice column
      // 2. autoSlices is currently empty
      // 3. We have top values available
      // 4. We're not currently refreshing
      // 5. User hasn't manually cleared the slices
      if (
        isAutoSliceColumn &&
        (!currentAutoSlices || currentAutoSlices.length === 0) &&
        topValues.length > 0 &&
        !refreshingTopValues &&
        !hasManuallyClearedSlices
      ) {
        // Populate with top values up to the max limit
        const newAutoSlices = topValues.slice(0, maxMetricSliceLevels);
        form.setValue("autoSlices", newAutoSlices);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      topValues,
      refreshingTopValues,
      shouldForceOverwriteSlices,
      isAutoSliceColumn,
    ],
  );

  // Calculate auto slice options combining topValues with current autoSlices
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
    lockedAutoSlices: form.watch("lockedAutoSlices"),
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
            lockedAutoSlices: value.lockedAutoSlices,
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

          if (data.datatype === "boolean" && data.autoSlices) {
            data.autoSlices = ["true", "false"];
          }

          await apiCall(
            `/fact-tables/${factTable.id}/column/${existing.column}`,
            {
              method: "PUT",
              body: JSON.stringify(data),
            },
          );
        } else {
          if (value.datatype === "boolean" && value.autoSlices) {
            value.autoSlices = ["true", "false"];
          }

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

      {isMetricSlicesFeatureEnabled &&
        (form.watch("datatype") === "string" ||
          form.watch("datatype") === "boolean") &&
        !factTable.userIdTypes.includes(form.watch("column")) &&
        form.watch("column") !== "timestamp" && (
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <div className="d-flex align-items-center mb-2">
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
                description={
                  <>
                    Column may be used to automatically slice metrics during
                    experiment analysis.{" "}
                    <DocLink docSection="autoSlices">
                      Learn More <PiArrowSquareOut />
                    </DocLink>
                  </>
                }
                disabled={!hasMetricSlicesFeature}
              />
            </div>

            {form.watch("isAutoSliceColumn") &&
              hasMetricSlicesFeature &&
              form.watch("datatype") !== "boolean" && (
                <div className="mt-4 mb-2">
                  <Flex align="center" gap="3" mt="2" mb="1">
                    <label className="form-label mb-0">Slices</label>
                    <div className="flex-1" />
                    <Flex align="center" gap="1">
                      <Tooltip
                        tipPosition="top"
                        body={
                          <Flex direction="column">
                            {(() => {
                              const autoUpdateFrequencyHours =
                                getAutoSliceUpdateFrequencyHours();
                              const autoUpdateFrequencyDays =
                                Math.round(
                                  (autoUpdateFrequencyHours / 24) * 10,
                                ) / 10;
                              const autoUpdateFrequencyText =
                                autoUpdateFrequencyDays >= 1
                                  ? `${autoUpdateFrequencyDays} ${
                                      autoUpdateFrequencyDays === 1
                                        ? "day"
                                        : "days"
                                    }`
                                  : `${autoUpdateFrequencyHours} ${
                                      autoUpdateFrequencyHours === 1
                                        ? "hour"
                                        : "hours"
                                    }`;
                              return (
                                <>
                                  {factTable.autoSliceUpdatesEnabled ? (
                                    <>
                                      <Text as="p">
                                        Auto-update slice levels based on top
                                        column values. Locked levels are always
                                        preserved.
                                      </Text>
                                      <Text as="p">
                                        <strong>Enabled</strong> — runs every{" "}
                                        {autoUpdateFrequencyText}. Limited to{" "}
                                        {maxMetricSliceLevels} slice levels
                                        (customizable in Organization Settings).
                                      </Text>
                                      {existing?.topValuesDate && (
                                        <div>
                                          <Text>
                                            Last run:{" "}
                                            {datetime(existing.topValuesDate)}
                                          </Text>
                                          {(() => {
                                            const frequencyHours =
                                              getAutoSliceUpdateFrequencyHours();
                                            const lastRun = getValidDate(
                                              existing.topValuesDate,
                                            );
                                            const nextRun = new Date(
                                              lastRun.getTime() +
                                                frequencyHours * 60 * 60 * 1000,
                                            );
                                            const now = new Date();
                                            return (
                                              <div>
                                                Next run:{" "}
                                                {nextRun > now ? (
                                                  <>
                                                    {datetime(nextRun)} (
                                                    {ago(nextRun)})
                                                  </>
                                                ) : (
                                                  <>
                                                    overdue (should run{" "}
                                                    {ago(nextRun)})
                                                  </>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <Text as="p">
                                        Auto-update slice levels based on top
                                        column values.
                                      </Text>
                                      <Text as="p">
                                        <strong>Disabled</strong> — enable in
                                        Fact Table settings.
                                      </Text>
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </Flex>
                        }
                      >
                        {factTable.autoSliceUpdatesEnabled ? (
                          <PiLightning size={16} />
                        ) : (
                          <PiLightningSlash size={16} />
                        )}
                      </Tooltip>
                      {existing?.topValuesDate ? (
                        <Tooltip
                          body={
                            <Text>
                              Last run: {datetime(existing.topValuesDate)}
                            </Text>
                          }
                        >
                          <Text
                            weight="regular"
                            size="1"
                            style={{ color: "var(--color-text-mid)" }}
                          >
                            Last run: {abbreviateAgo(existing.topValuesDate)}
                          </Text>
                        </Tooltip>
                      ) : (
                        <Text
                          weight="regular"
                          size="1"
                          style={{ color: "var(--color-text-mid)" }}
                        >
                          Last run: Never
                        </Text>
                      )}
                    </Flex>
                    <RadixButton
                      size="xs"
                      variant="outline"
                      onClick={refreshTopValues}
                      loading={refreshingTopValues}
                    >
                      <PiArrowClockwise />{" "}
                      {!factTable.autoSliceUpdatesEnabled
                        ? "Use Top Values"
                        : "Update"}
                    </RadixButton>
                  </Flex>

                  {autoSlicesWarning ||
                  (form.watch("autoSlices") || [])?.length >
                    maxMetricSliceLevels ? (
                    <HelperText status="warning" mb="1">
                      Limit {maxMetricSliceLevels + ""} slices
                    </HelperText>
                  ) : null}

                  {factTable.autoSliceUpdatesEnabled ? (
                    <div className="mt-2">
                      {(existing?.topValues || []).length === 0 &&
                      existing?.topValuesDate ? (
                        <HelperText status="warning" mb="1">
                          No slices returned from top values query
                        </HelperText>
                      ) : null}
                      <table className="table table-tiny gbtable mb-0">
                        <tbody>
                          {(form.watch("autoSlices") || []).map((slice) => {
                            const isLocked = (
                              form.watch("lockedAutoSlices") || []
                            ).includes(slice);
                            const isInTopValues = (
                              existing?.topValues || []
                            ).includes(slice);
                            return (
                              <tr key={slice}>
                                <td>{slice}</td>
                                <td style={{ width: "110px" }}>
                                  {!isInTopValues && (
                                    <Text size="1" color="gray">
                                      Not a top value
                                    </Text>
                                  )}
                                </td>
                                <td style={{ width: "70px" }}>
                                  <div style={{ marginTop: "1px" }}>
                                    <Checkbox
                                      label={<Text size="1">Lock</Text>}
                                      weight="regular"
                                      value={isLocked}
                                      setValue={(value) => {
                                        const currentLocked =
                                          form.watch("lockedAutoSlices") || [];
                                        const currentSlices =
                                          form.watch("autoSlices") || [];
                                        if (value) {
                                          form.setValue("lockedAutoSlices", [
                                            ...currentLocked,
                                            slice,
                                          ]);
                                        } else {
                                          // If unlocking a slice that's not in topValues, remove it completely
                                          if (!isInTopValues) {
                                            form.setValue(
                                              "autoSlices",
                                              currentSlices.filter(
                                                (s) => s !== slice,
                                              ),
                                            );
                                            form.setValue(
                                              "lockedAutoSlices",
                                              currentLocked.filter(
                                                (s) => s !== slice,
                                              ),
                                            );
                                          } else {
                                            // Just unlock if it's in topValues
                                            form.setValue(
                                              "lockedAutoSlices",
                                              currentLocked.filter(
                                                (s) => s !== slice,
                                              ),
                                            );
                                          }
                                        }
                                      }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!showAddSliceInput ? (
                        <Link
                          onClick={(e) => {
                            e.preventDefault();
                            setShowAddSliceInput(true);
                          }}
                          mt="2"
                        >
                          <Flex align="center" gap="1">
                            <PiPlus />
                            <Text weight="medium">Add slices manually</Text>
                          </Flex>
                        </Link>
                      ) : (
                        <Flex mt="2" gap="2" align="center">
                          <div style={{ flex: 1 }}>
                            <Field
                              style={{ height: 28 }}
                              value={newSliceValue}
                              onChange={(e) => setNewSliceValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  const trimmed = newSliceValue.trim();
                                  if (trimmed) {
                                    const currentSlices =
                                      form.watch("autoSlices") || [];
                                    const currentLocked =
                                      form.watch("lockedAutoSlices") || [];
                                    if (!currentSlices.includes(trimmed)) {
                                      form.setValue("autoSlices", [
                                        ...currentSlices,
                                        trimmed,
                                      ]);
                                      form.setValue("lockedAutoSlices", [
                                        ...currentLocked,
                                        trimmed,
                                      ]);
                                      setNewSliceValue("");
                                    }
                                  }
                                }
                              }}
                              placeholder="Enter slice..."
                              containerClassName="mb-0"
                              autoFocus
                            />
                          </div>
                          <RadixButton
                            size="sm"
                            variant="ghost"
                            ml="2"
                            style={{ height: 28 }}
                            onClick={() => {
                              const trimmed = newSliceValue.trim();
                              if (trimmed) {
                                const currentSlices =
                                  form.watch("autoSlices") || [];
                                const currentLocked =
                                  form.watch("lockedAutoSlices") || [];
                                if (!currentSlices.includes(trimmed)) {
                                  form.setValue("autoSlices", [
                                    ...currentSlices,
                                    trimmed,
                                  ]);
                                  form.setValue("lockedAutoSlices", [
                                    ...currentLocked,
                                    trimmed,
                                  ]);
                                  setNewSliceValue("");
                                }
                              }
                            }}
                          >
                            Add
                          </RadixButton>
                        </Flex>
                      )}
                    </div>
                  ) : (
                    <>
                      {(form.watch("autoSlices") || []).length === 0 && (
                        <div className="text-muted mb-2 small">
                          No slices configured. Click &quot;Use Top Values&quot;
                          or manually enter slices below.
                        </div>
                      )}
                      <MultiSelectField
                        value={form.watch("autoSlices") || []}
                        onChange={(values) => {
                          if (values.length > maxMetricSliceLevels) {
                            values = values.slice(0, maxMetricSliceLevels);
                            setAutoSlicesWarning(true);
                            setTimeout(() => {
                              setAutoSlicesWarning(false);
                            }, 3000);
                          }
                          // Track if user manually clears all slices
                          if (values.length === 0) {
                            setHasManuallyClearedSlices(true);
                          }
                          form.setValue("autoSlices", values);
                        }}
                        options={autoSliceOptions}
                        creatable={true}
                        placeholder="Select or enter slices..."
                      />
                    </>
                  )}
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
    </Modal>
  );
}
