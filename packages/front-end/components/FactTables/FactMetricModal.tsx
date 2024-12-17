import { useForm, UseFormReturn } from "react-hook-form";
import omit from "lodash/omit";
import { ReactElement, useEffect, useState } from "react";
import { FaArrowRight, FaTimes } from "react-icons/fa";
import { FaTriangleExclamation } from "react-icons/fa6";
import { Box } from "@radix-ui/themes";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { isProjectListValidForProject } from "shared/util";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  ColumnRef,
  UpdateFactMetricProps,
  MetricQuantileSettings,
  FactMetricType,
  FactTableInterface,
  MetricWindowSettings,
  ColumnInterface,
  ColumnAggregation,
  FactTableColumnType,
} from "back-end/types/fact-table";
import {
  canInlineFilterColumn,
  getAggregateFilters,
  getColumnRefWhereClause,
  getSelectedColumnDatatype,
} from "shared/experiments";
import { PiPlus } from "react-icons/pi";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  formatNumber,
  getDefaultFactMetricProps,
  getInitialInlineFilters,
} from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { capitalizeFirstLetter } from "@/services/utils";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import RiskThresholds from "@/components/Metrics/MetricForm/RiskThresholds";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Radix/Tabs";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "@/components/Metrics/MetricForm/MetricCappingSettingsForm";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { MetricDelaySettings } from "@/components/Metrics/MetricForm/MetricDelaySettings";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";
import Checkbox from "@/components/Radix/Checkbox";
import Callout from "@/components/Radix/Callout";
import Code from "@/components/SyntaxHighlighting/Code";
import HelperText from "@/components/Radix/HelperText";
import StringArrayField from "@/components/Forms/StringArrayField";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";

export interface Props {
  close?: () => void;
  initialFactTable?: string;
  existing?: Partial<FactMetricInterface>;
  duplicate?: boolean;
  fromTemplate?: boolean;
  showAdvancedSettings?: boolean;
  onSave?: () => void;
  switchToLegacy?: () => void;
  source: string;
  datasource?: string;
}

function QuantileSelector({
  value,
  setValue,
}: {
  value: MetricQuantileSettings;
  setValue: (v: MetricQuantileSettings) => void;
}) {
  const options: { label: string; value: string }[] = [
    { label: "Median (P50)", value: "0.5" },
    { label: "P90", value: "0.9" },
    { label: "P95", value: "0.95" },
    { label: "P99", value: "0.99" },
    { label: "Custom", value: "custom" },
  ];

  const isCustom =
    value.quantile && !options.some((o) => o.value === value.quantile + "");
  const [showCustom, setShowCustom] = useState(isCustom);

  return (
    <div className="row align-items-center">
      <div className="col-auto">
        <SelectField
          label="Quantile"
          value={showCustom ? "custom" : value.quantile + ""}
          onChange={(v) => {
            if (v === "custom") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            setValue({ ...value, quantile: parseFloat(v) });
          }}
          options={options}
          sort={false}
        />
      </div>
      {showCustom && (
        <div className="col-auto">
          <Field
            label="&nbsp;"
            autoFocus
            type="number"
            step={0.001}
            min={0.001}
            max={0.999}
            value={value.quantile}
            onBlur={() => {
              // Fix common issue of entering 90 instead of 0.9
              if (value.quantile > 10 && value.quantile < 100) {
                setValue({
                  ...value,
                  quantile: value.quantile / 100,
                });
              }
            }}
            onChange={(event) => {
              const v = parseFloat(event.target.value);
              setValue({
                ...value,
                quantile: v,
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

function getNumericColumns(
  factTable: FactTableInterface | null
): ColumnInterface[] {
  if (!factTable) return [];
  return factTable.columns.filter(
    (col) =>
      col.datatype === "number" &&
      !col.deleted &&
      col.column !== "timestamp" &&
      !factTable.userIdTypes.includes(col.column)
  );
}

function getColumnOptions({
  factTable,
  includeCount = true,
  includeCountDistinct = false,
  includeStringColumns = false,
  showColumnsAsSums = false,
  groupPrefix = "",
}: {
  factTable: FactTableInterface | null;
  includeCount?: boolean;
  includeCountDistinct?: boolean;
  includeStringColumns?: boolean;
  showColumnsAsSums?: boolean;
  groupPrefix?: string;
}): SingleValue[] | GroupedValue[] {
  const numericColumnOptions: SingleValue[] = getNumericColumns(factTable).map(
    (col) => ({
      label: showColumnsAsSums ? `SUM(${col.name})` : col.name,
      value: col.column,
    })
  );

  const specialColumnOptions: SingleValue[] = [];
  if (includeCountDistinct) {
    specialColumnOptions.push({
      label: `Unique Users`,
      value: "$$distinctUsers",
    });
  }
  if (includeCount) {
    specialColumnOptions.push({
      label: "Count of Rows",
      value: "$$count",
    });
  }

  const stringColumnOptions: SingleValue[] = [];

  if (includeStringColumns) {
    const stringColumns = factTable?.columns.filter(
      (col) => col.datatype === "string"
    );
    if (stringColumns) {
      stringColumnOptions.push(
        ...stringColumns.map((col) => ({
          label: col.name,
          value: col.column,
        }))
      );
    }
  }

  return [
    ...(specialColumnOptions.length > 0
      ? [
          {
            label: `${groupPrefix}Special`,
            options: specialColumnOptions,
          },
        ]
      : []),
    {
      label: `${groupPrefix} Numeric Columns`,
      options: numericColumnOptions,
    },

    ...(stringColumnOptions.length > 0
      ? [
          {
            label: `${groupPrefix} String Columns`,
            options: stringColumnOptions,
          },
        ]
      : []),
  ];
}

function getAggregationOptions(
  selectedColumnDatatype: FactTableColumnType | undefined
): {
  label: string;
  value: ColumnAggregation;
}[] {
  if (selectedColumnDatatype === "string") {
    return [
      {
        label: "Count Distinct",
        value: "count distinct",
      },
    ];
  }

  return [
    { label: "Sum", value: "sum" },
    { label: "Max", value: "max" },
  ];
}

function RetentionWindowSelector({
  form,
}: {
  form: UseFormReturn<CreateFactMetricProps>;
}) {
  return (
    <div>
      <div className="appbox px-3 pt-3 bg-light">
        <div className="row align-items-center mb-3">
          <div className="col-auto">Event must be at least</div>
          <div className="col-auto">
            <Field
              {...form?.register("windowSettings.delayValue", {
                valueAsNumber: true,
              })}
              type="number"
              min={1}
              max={999}
              step={1}
              style={{ width: 70 }}
              required
              autoFocus
            />
          </div>
          <div className="col-auto ">
            <SelectField
              value={form?.watch("windowSettings.delayUnit") ?? "days"}
              onChange={(value) => {
                form.setValue(
                  "windowSettings.delayUnit",
                  value as "days" | "hours" | "weeks"
                );
              }}
              sort={false}
              options={[
                {
                  label: "Minutes",
                  value: "minutes",
                },
                {
                  label: "Hours",
                  value: "hours",
                },
                {
                  label: "Days",
                  value: "days",
                },
                {
                  label: "Weeks",
                  value: "weeks",
                },
              ]}
            />
          </div>
          <div className="col-auto">after experiment exposure</div>
        </div>
      </div>
    </div>
  );
}

function ColumnRefSelector({
  value,
  setValue,
  setDatasource,
  includeCountDistinct,
  aggregationType = "unit",
  includeColumn,
  datasource,
  disableFactTableSelector,
  extraField,
  supportsAggregatedFilter,
  allowChangingDatasource,
}: {
  setValue: (ref: ColumnRef) => void;
  setDatasource: (datasource: string) => void;
  value: ColumnRef;
  includeCountDistinct?: boolean;
  includeColumn?: boolean;
  aggregationType?: "unit" | "event";
  datasource: DataSourceInterfaceWithParams;
  disableFactTableSelector?: boolean;
  extraField?: ReactElement;
  supportsAggregatedFilter?: boolean;
  allowChangingDatasource?: boolean;
}) {
  const { getFactTableById, factTables } = useDefinitions();

  let factTable = getFactTableById(value.factTableId);
  if (factTable?.datasource !== datasource.id) factTable = null;

  const columnOptions = getColumnOptions({
    factTable,
    includeCountDistinct: includeCountDistinct && aggregationType === "unit",
    includeCount: aggregationType === "unit",
    includeStringColumns:
      datasource.properties?.hasCountDistinctHLL && aggregationType === "unit",
  });

  const selectedColumnDatatype = getSelectedColumnDatatype({
    factTable,
    column: value.column,
  });

  const aggregationOptions = getAggregationOptions(selectedColumnDatatype);

  const [addRowFilter, setAddRowFilter] = useState(false);
  const [addUserFilter, setAddUserFilter] = useState(false);

  const addFilterOptions: GroupedValue[] = [];

  const eligibleFilters = factTable?.filters || [];
  const unusedFilters = eligibleFilters.filter(
    (f) => !value.filters.includes(f.id)
  );
  if (unusedFilters.length > 0) {
    addFilterOptions.push({
      label: "Saved Filters",
      options: unusedFilters.map((f) => ({
        label: f.name,
        value: f.id,
      })),
    });
  }

  const eligibleColumns =
    factTable?.columns?.filter((c) => canInlineFilterColumn(factTable, c)) ||
    [];
  const unfilteredStringColumns = eligibleColumns.filter(
    (c) => !value.inlineFilters?.[c.column]?.length
  );
  if (unfilteredStringColumns.length > 0) {
    addFilterOptions.push({
      label: "Filter by Column",
      options: unfilteredStringColumns.map((c) => ({
        label: c.name || c.column,
        value: `col::${c.column}`,
      })),
    });
  }

  const canFilterRows =
    eligibleFilters.length > 0 || eligibleColumns.length > 0;

  return (
    <div className="appbox px-3 pt-3 bg-light">
      <div className="row align-items-top">
        <div className="col-auto">
          <SelectField
            label={"Fact Table"}
            disabled={disableFactTableSelector}
            value={value.factTableId}
            onChange={(factTableId) => {
              const newFactTable = getFactTableById(factTableId);
              if (!newFactTable) return;

              const inlineFilters = getInitialInlineFilters(
                newFactTable,
                value.inlineFilters
              );

              // If switching between fact tables, wipe out inline and aggregate filters
              if (value.factTableId) {
                // If the column is not valid for the new fact table, reset it
                let newColumn = value.column;
                if (
                  !value.column?.match(/^\$\$/) &&
                  !newFactTable?.columns.find((c) => c.column === newColumn)
                ) {
                  newColumn = "$$count";
                }

                setValue({
                  factTableId,
                  column: newColumn,
                  inlineFilters,
                  filters: [],
                });
              }
              // If selecting a fact table for the first time, keep the existing inline/aggregate filters
              else {
                setValue({
                  ...value,
                  factTableId,
                  inlineFilters,
                  filters: [],
                });
              }

              setDatasource(newFactTable.datasource);
            }}
            options={factTables
              .filter(
                (t) => allowChangingDatasource || t.datasource === datasource.id
              )
              .map((t) => ({
                label: t.name,
                value: t.id,
              }))}
            formatOptionLabel={({ value, label }) => {
              const factTable = getFactTableById(value);
              if (factTable) {
                return (
                  <>
                    {factTable.name}
                    <OfficialBadge
                      managedBy={factTable.managedBy}
                      type="fact table"
                    />
                  </>
                );
              }
              return label;
            }}
            placeholder="Select..."
            required
          />
        </div>
        {factTable && canFilterRows ? (
          <div className="col-auto">
            <div className="form-group">
              <label>
                Row Filter{" "}
                <Tooltip body="Filter individual rows.  Only rows that satisfy ALL selected filters will be included" />
              </label>
              <div className="d-flex flex-wrap align-items-top">
                {value.filters.map((f) => {
                  const filter = factTable.filters.find((ff) => ff.id === f);
                  if (!filter) return null;
                  return (
                    <div
                      className="border rounded py-2 px-2 mr-1 d-flex align-items-center bg-white"
                      key={f}
                    >
                      <Tooltip
                        body={<InlineCode language="sql" code={filter.value} />}
                      >
                        <span className="cursor-default">{filter.name}</span>
                      </Tooltip>
                      <OfficialBadge
                        managedBy={filter.managedBy}
                        type="filter"
                      />
                      <button
                        type="button"
                        className="btn btn-link p-0 ml-1 text-muted"
                        onClick={() =>
                          setValue({
                            ...value,
                            filters: value.filters.filter((ff) => ff !== f),
                          })
                        }
                      >
                        <FaTimes />
                      </button>
                    </div>
                  );
                })}
                {Object.entries(value.inlineFilters || {}).map(([k, v]) => {
                  if (!v.length) return null;
                  v = v.filter((v) => !!v);
                  const col = factTable.columns.find((c) => c.column === k);

                  const onValuesChange = (v: string[]) => {
                    v = [...new Set(v.filter((v) => !!v))];

                    setValue({
                      ...value,
                      inlineFilters: { ...value.inlineFilters, [k]: v },
                    });
                  };

                  const colAlert =
                    !col || !canInlineFilterColumn(factTable, col) ? (
                      <Tooltip
                        body={`This column ${
                          col
                            ? "cannot be filtered on"
                            : "does not exist in this fact table"
                        }`}
                      >
                        <FaTriangleExclamation className="text-danger ml-1" />
                      </Tooltip>
                    ) : null;

                  const options = new Set(col?.topValues || []);
                  v.forEach((v) => options.add(v));

                  return (
                    <div
                      className="border rounded mr-1 d-flex align-items-center bg-white"
                      key={k}
                    >
                      {colAlert && unfilteredStringColumns.length > 0 ? (
                        <SelectField
                          value={k}
                          options={[
                            { label: col?.name || k, value: k },
                            ...unfilteredStringColumns.map((c) => ({
                              label: c.name || c.column,
                              value: c.column,
                            })),
                          ]}
                          onChange={(newKey) => {
                            if (k === newKey || !value.inlineFilters) return;
                            setValue({
                              ...value,
                              inlineFilters: {
                                ...omit(value.inlineFilters || {}, k),
                                [newKey]: value.inlineFilters[k],
                              },
                            });
                          }}
                          formatOptionLabel={({ value, label }) => {
                            return value === k ? (
                              <>
                                {label}
                                {colAlert}
                              </>
                            ) : (
                              label
                            );
                          }}
                        />
                      ) : (
                        <span className="px-2">
                          {col?.name || k}
                          {colAlert}
                        </span>
                      )}
                      {col?.topValues?.length ? (
                        <MultiSelectField
                          value={v}
                          onChange={onValuesChange}
                          options={[...options].map((o) => ({
                            label: o,
                            value: o,
                          }))}
                          initialOption="Any"
                          formatOptionLabel={({ value, label }) =>
                            value ? (
                              label
                            ) : (
                              <em className="text-muted">{label}</em>
                            )
                          }
                          autoFocus
                          creatable
                          sort={false}
                        />
                      ) : (
                        <StringArrayField
                          value={v}
                          onChange={onValuesChange}
                          placeholder="Any"
                          autoFocus
                        />
                      )}
                    </div>
                  );
                })}

                {addFilterOptions.length > 0 ? (
                  addRowFilter ? (
                    <>
                      <SelectField
                        value=""
                        onChange={(v) => {
                          if (v) {
                            if (v.startsWith("col::")) {
                              setValue({
                                ...value,
                                inlineFilters: {
                                  ...value.inlineFilters,
                                  [v.replace("col::", "")]: [""],
                                },
                              });
                            } else {
                              setValue({
                                ...value,
                                filters: [...value.filters, v],
                              });
                            }
                          }
                          setAddRowFilter(false);
                        }}
                        options={addFilterOptions}
                        onBlur={() => setAddRowFilter(false)}
                        sort={false}
                        autoFocus
                      />
                    </>
                  ) : (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setAddRowFilter(true);
                      }}
                      className="py-2"
                    >
                      <PiPlus />{" "}
                      {Object.values(value.inlineFilters || {}).some(
                        (v) => v.length > 0
                      ) || value.filters.length > 0
                        ? "Row Filter"
                        : "Add"}
                    </a>
                  )
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {includeColumn && (
          <div className="col-auto">
            <SelectField
              label="Value"
              value={value.column}
              onChange={(column) => {
                const newDatatype = getSelectedColumnDatatype({
                  factTable,
                  column,
                });

                let aggregation = value.aggregation;

                if (newDatatype === "string") {
                  aggregation = "count distinct";
                } else if (aggregation === "count distinct") {
                  aggregation = "sum";
                }

                setValue({ ...value, column, aggregation });
              }}
              sort={false}
              formatGroupLabel={({ label }) => (
                <div className="pt-2 pb-1 border-bottom">{label}</div>
              )}
              options={columnOptions}
              placeholder="Value..."
              required
            />
          </div>
        )}
        {includeColumn &&
          !value.column.startsWith("$$") &&
          aggregationType === "unit" && (
            <div className="col-auto">
              <SelectField
                label={"Aggregation"}
                value={value.aggregation || "sum"}
                onChange={(v) =>
                  setValue({
                    ...value,
                    aggregation: v as ColumnAggregation,
                  })
                }
                sort={false}
                options={aggregationOptions}
              />
            </div>
          )}
        {supportsAggregatedFilter && factTable && (
          <div className="col-auto d-flex align-items-top">
            <div className="form-group">
              <label>
                User Filter{" "}
                <Tooltip
                  body={
                    <>
                      Filter after grouping by user id. Simple comparison
                      operators only. For example, <code>&gt;= 3</code> or{" "}
                      <code>&lt; 10</code>
                    </>
                  }
                />
              </label>
              {value.aggregateFilterColumn || addUserFilter ? (
                <div className="d-flex align-items-center">
                  <SelectField
                    value={value.aggregateFilterColumn || ""}
                    onChange={(v) =>
                      setValue({
                        ...value,
                        aggregateFilterColumn: v,
                      })
                    }
                    options={getColumnOptions({
                      factTable: factTable,
                      includeCount: true,
                      includeCountDistinct: false,
                      includeStringColumns: false,
                      showColumnsAsSums: true,
                      groupPrefix: "Filter by ",
                    })}
                    initialOption="Any User"
                    autoFocus
                    onBlur={() => setAddUserFilter(false)}
                  />
                  {value.aggregateFilterColumn ? (
                    <div className="ml-1">
                      <Field
                        value={value.aggregateFilter || ""}
                        onChange={(v) =>
                          setValue({
                            ...value,
                            aggregateFilter: v.target.value,
                          })
                        }
                        placeholder=">= 10"
                        style={{ maxWidth: 100 }}
                        required
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="py-2">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setAddUserFilter(true);
                    }}
                  >
                    <PiPlus /> Add
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
        {extraField && <>{extraField}</>}
      </div>
    </div>
  );
}

function indentLines(str: string, spaces: number = 2) {
  return str
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");
}

function getWHERE({
  factTable,
  columnRef,
  windowSettings,
  quantileSettings,
  type,
}: {
  factTable: FactTableInterface | null;
  columnRef: ColumnRef | null;
  windowSettings: MetricWindowSettings;
  quantileSettings: MetricQuantileSettings;
  type: FactMetricType;
}) {
  const whereParts =
    factTable && columnRef
      ? getColumnRefWhereClause(
          factTable,
          columnRef,
          (s) => s.replace(/'/g, "''"),
          true
        )
      : [];

  if (type === "retention") {
    whereParts.push(
      `-- Only after seeing the experiment + retention delay\ntimestamp > (exposure_timestamp + '${
        windowSettings.delayValue
      } ${windowSettings.delayUnit ?? "days"}')`
    );
  } else if (windowSettings.delayValue) {
    whereParts.push(
      `-- Only after seeing the experiment + delay\ntimestamp > (exposure_timestamp + '${windowSettings.delayValue} ${windowSettings.delayUnit}')`
    );
  } else {
    whereParts.push(
      `-- Only after seeing the experiment\ntimestamp > exposure_timestamp`
    );
  }

  if (windowSettings.type === "lookback") {
    whereParts.push(
      `-- Lookback Metric Window\ntimestamp > (NOW() - '${windowSettings.windowValue} ${windowSettings.windowUnit}')`
    );
  } else if (windowSettings.type === "conversion") {
    if (type === "retention") {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${
          windowSettings.delayValue
        } ${windowSettings.delayUnit ?? "days"}' + '${
          windowSettings.windowValue
        } ${windowSettings.windowUnit}')`
      );
    } else if (windowSettings.delayValue) {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${windowSettings.delayValue} ${windowSettings.delayUnit}' + '${windowSettings.windowValue} ${windowSettings.windowUnit}')`
      );
    } else {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${windowSettings.windowValue} ${windowSettings.windowUnit}')`
      );
    }
  }
  if (
    type === "quantile" &&
    quantileSettings.type === "event" &&
    quantileSettings.ignoreZeros
  ) {
    whereParts.push(`-- Ignore zeros in percentile\nvalue > 0`);
  }

  return whereParts.length > 0
    ? `\nWHERE\n${indentLines(whereParts.join(" AND\n"))}`
    : "";
}

function getPreviewSQL({
  type,
  quantileSettings,
  windowSettings,
  numerator,
  denominator,
  numeratorFactTable,
  denominatorFactTable,
}: {
  type: FactMetricType;
  quantileSettings: MetricQuantileSettings;
  windowSettings: MetricWindowSettings;
  numerator: ColumnRef;
  denominator: ColumnRef | null;
  numeratorFactTable: FactTableInterface | null;
  denominatorFactTable: FactTableInterface | null;
}): { sql: string; denominatorSQL?: string; experimentSQL: string } {
  const identifier =
    "`" + (numeratorFactTable?.userIdTypes?.[0] || "user_id") + "`";

  const identifierComment =
    (numeratorFactTable?.userIdTypes?.length || 0) > 1
      ? `\n  -- All of the Fact Table's identifier types are supported`
      : "";

  const numeratorName = "`" + (numeratorFactTable?.name || "Fact Table") + "`";
  const denominatorName =
    "`" + (denominatorFactTable?.name || "Fact Table") + "`";

  const numeratorCol =
    numerator.column === "$$count"
      ? "COUNT(*)"
      : numerator.column === "$$distinctUsers"
      ? "1"
      : numerator.aggregation === "count distinct"
      ? `COUNT(DISTINCT ${numerator.column})`
      : `${(numerator.aggregation ?? "sum").toUpperCase()}(${
          numerator.column
        })`;

  const denominatorCol =
    denominator?.column === "$$count"
      ? "COUNT(*)"
      : denominator?.column === "$$distinctUsers"
      ? "1"
      : numerator.aggregation === "count distinct"
      ? `-- HyperLogLog estimation used instead of COUNT DISTINCT\n  COUNT(DISTINCT ${denominator?.column})`
      : `${(denominator?.aggregation ?? "sum").toUpperCase()}(${
          denominator?.column
        })`;

  const WHERE = getWHERE({
    factTable: numeratorFactTable,
    columnRef: numerator,
    windowSettings,
    quantileSettings,
    type,
  });

  const DENOMINATOR_WHERE = getWHERE({
    factTable: denominatorFactTable,
    columnRef: denominator,
    windowSettings,
    quantileSettings,
    type,
  });

  const havingParts = getAggregateFilters({
    columnRef: {
      // Column is often set incorrectly for proportion metrics and changed later during submit
      ...numerator,
      column: type === "proportion" ? "$$distinctUsers" : numerator.column,
    },
    column:
      numerator.aggregateFilterColumn === "$$count"
        ? `COUNT(*)`
        : `SUM(${numerator.aggregateFilterColumn})`,
    ignoreInvalid: true,
  });
  let HAVING =
    havingParts.length > 0
      ? `\nHAVING\n${indentLines(havingParts.join("\nAND "))}`
      : "";

  if (type === "quantile") {
    HAVING = "";
    if (quantileSettings.type === "unit" && quantileSettings.ignoreZeros) {
      HAVING = `\n-- Ignore zeros in percentile\nHAVING ${numeratorCol} > 0`;
    }
  }

  const experimentSQL = `
SELECT
  variation,
  ${
    type !== "quantile"
      ? `${
          type === "proportion" || numerator.column === "$$distinctUsers"
            ? `-- Number of users who converted`
            : `-- Total ${type === "ratio" ? "numerator" : "metric"} value`
        }
  SUM(m.value) as numerator,
  ${
    type === "ratio"
      ? `-- ${
          denominator?.column === "$$distinctusers"
            ? `Number of users who converted`
            : `Total denominator value`
        }\n  SUM(d.value)`
      : `-- Number of users in experiment\n  COUNT(*)`
  } as denominator,\n  `
      : ""
  }${
    type === "quantile"
      ? `-- Final result\n  PERCENTILE(${
          quantileSettings.ignoreZeros
            ? `m.value,`
            : `\n    -- COALESCE to include NULL in the calculation\n    COALESCE(m.value, 0),\n  `
        }  ${quantileSettings.quantile}${
          !quantileSettings.ignoreZeros ? "\n  " : ""
        })`
      : `-- Final result\n  numerator / denominator`
  } AS value
FROM
  experiment_users u
  LEFT JOIN ${
    type === "ratio" ? "numerator" : "metric"
  } m ON (m.user = u.user)${
    type === "ratio"
      ? `
  LEFT JOIN denominator d ON (d.user = u.user)`
      : ``
  }
GROUP BY variation`.trim();

  switch (type) {
    case "retention":
    case "proportion":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,
  -- Each matching user counts as 1 conversion
  1 AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user${HAVING}
`.trim(),

        experimentSQL,
      };
    case "mean":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,
  ${numeratorCol} AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user
`.trim(),
        experimentSQL,
      };
    case "ratio":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,${
          numerator.column === "$$distinctUsers"
            ? `\n  -- Each matching user counts as 1 conversion`
            : ""
        }
  ${numeratorCol} AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user${HAVING}
`.trim(),
        denominatorSQL: `
SELECT${identifierComment}
  ${identifier} AS user,${
          denominator?.column === "$$distinctUsers"
            ? `\n  -- Each matching user counts as 1 conversion`
            : ""
        }
  ${denominatorCol} AS value
FROM
  ${denominatorName}${DENOMINATOR_WHERE}
GROUP BY user
`.trim(),
        experimentSQL,
      };
    case "quantile":
      // TODO: handle event vs user level quantiles
      return {
        sql:
          quantileSettings.type === "unit"
            ? `
SELECT${identifierComment}
  ${identifier} AS user,
  ${numeratorCol} AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user${HAVING}
`.trim()
            : `
SELECT${identifierComment}
  ${identifier} AS user,
  \`${numerator.column}\` AS value
FROM
  ${numeratorName}${WHERE}
`.trim(),
        experimentSQL,
      };
  }
}

function FieldMappingModal({
  factMetric,
  onSave,
  close,
}: {
  factMetric: Partial<FactMetricInterface>;
  onSave: (metric: Partial<FactMetricInterface>) => void;
  close?: () => void;
}) {
  const { factTables, getFactTableById } = useDefinitions();

  const [data, setData] = useState(factMetric);

  const numerator = data.numerator as ColumnRef;
  const denominator = data.denominator;

  const numericColumns = new Set<string>();
  const stringColumns = new Set<string>();

  if (numerator.column && !numerator.column.startsWith("$$")) {
    numericColumns.add(numerator.column);
  }
  if (denominator?.column && !denominator.column.startsWith("$$")) {
    numericColumns.add(denominator.column);
  }
  if (
    numerator.aggregateFilterColumn &&
    !numerator.aggregateFilterColumn.startsWith("$$")
  ) {
    numericColumns.add(numerator.aggregateFilterColumn);
  }
  if (numerator.inlineFilters) {
    Object.keys(numerator.inlineFilters).forEach((k) => {
      stringColumns.add(k);
    });
  }
  if (denominator?.inlineFilters) {
    Object.keys(denominator.inlineFilters).forEach((k) => {
      stringColumns.add(k);
    });
  }

  const [numericColumnMap, setNumericColumnMap] = useState<
    Record<string, string>
  >(Object.fromEntries([...numericColumns].map((c) => [c, ""])));
  const [stringColumnMap, setStringColumnMap] = useState<
    Record<string, string>
  >(Object.fromEntries([...stringColumns].map((c) => [c, ""])));

  const factTable = getFactTableById(numerator.factTableId);

  const numericColumnOptions = getColumnOptions({
    factTable,
    includeCount: false,
    includeCountDistinct: false,
    includeStringColumns: false,
  });

  const stringColumnOptions =
    factTable?.columns
      ?.filter((c) => canInlineFilterColumn(factTable, c))
      .map((c) => ({
        label: c.name || c.column,
        value: c.column,
      })) || [];

  return (
    <Modal
      close={close}
      header="Create Fact Metric From Template"
      trackingEventModalType=""
      open={true}
      cta="Preview Metric"
      autoCloseOnSubmit={false}
      submit={() => {
        // Replace columns throughout metric definition
        if (numerator.column && numerator.column in numericColumnMap) {
          (data.numerator as ColumnRef).column =
            numericColumnMap[numerator.column];
        }
        if (
          numerator.aggregateFilterColumn &&
          numerator.aggregateFilterColumn in numericColumnMap
        ) {
          (data.numerator as ColumnRef).aggregateFilterColumn =
            numericColumnMap[numerator.aggregateFilterColumn];
        }
        if (numerator.inlineFilters) {
          const newInlineFilters: Record<string, string[]> = {};
          Object.entries(numerator.inlineFilters).forEach(([k, v]) => {
            if (k in stringColumnMap) {
              newInlineFilters[stringColumnMap[k]] = v;
            } else {
              newInlineFilters[k] = v;
            }
          });
          (data.numerator as ColumnRef).inlineFilters = newInlineFilters;
        }

        if (denominator) {
          if (denominator.column in numericColumnMap) {
            (data.denominator as ColumnRef).column =
              numericColumnMap[denominator.column];
          }
          if (denominator.inlineFilters) {
            const newInlineFilters: Record<string, string[]> = {};
            Object.entries(denominator.inlineFilters).forEach(([k, v]) => {
              if (k in stringColumnMap) {
                newInlineFilters[stringColumnMap[k]] = v;
              } else {
                newInlineFilters[k] = v;
              }
            });
            (data.denominator as ColumnRef).inlineFilters = newInlineFilters;
          }
        }

        data.datasource = factTable?.datasource || "";

        onSave(data);
      }}
    >
      <div className="appbox bg-light p-3">
        <div>
          <strong>Metric Name:</strong> {factMetric.name}
        </div>
        {factMetric.description ? (
          <div className="mt-2">
            <strong>Description:</strong> {factMetric.description}
          </div>
        ) : null}
      </div>
      <p>Which fact table do you want to add this metric to?</p>
      <SelectField
        label={"Fact Table"}
        value={numerator?.factTableId || ""}
        onChange={(factTableId) => {
          setData({
            ...data,
            numerator: { ...numerator, factTableId },
            denominator: data.denominator
              ? { ...data.denominator, factTableId }
              : undefined,
          });

          const factTable = getFactTableById(factTableId);
          if (factTable) {
            // Fill out any column mappings with matching column names
            const newNumericColumnMap = { ...numericColumnMap };
            const newStringColumnMap = { ...stringColumnMap };

            Object.keys(numericColumnMap).forEach((k) => {
              if (
                factTable.columns.find(
                  (c) => c.column === k && !c.deleted && c.datatype === "number"
                )
              ) {
                newNumericColumnMap[k] = k;
              }
            });

            Object.keys(stringColumnMap).forEach((k) => {
              if (
                factTable.columns.find(
                  (c) => c.column === k && canInlineFilterColumn(factTable, c)
                )
              ) {
                newStringColumnMap[k] = k;
              }
            });

            setNumericColumnMap(newNumericColumnMap);
            setStringColumnMap(newStringColumnMap);
          }
        }}
        options={factTables.map((t) => ({
          label: t.name,
          value: t.id,
        }))}
        formatOptionLabel={({ value, label }) => {
          const factTable = getFactTableById(value);
          if (factTable) {
            return (
              <>
                {factTable.name}
                <OfficialBadge
                  managedBy={factTable.managedBy}
                  type="fact table"
                />
              </>
            );
          }
          return label;
        }}
        placeholder="Select..."
        required
      />
      {factTable && (
        <>
          {numericColumns.size > 0 || stringColumns.size > 0 ? (
            <>
              <hr />
              <p>
                The following columns are referenced in this metric. Select how
                to map them to columns in your fact table.
              </p>
            </>
          ) : null}
          {numericColumns.size > 0 && !numericColumnOptions.length ? (
            <Callout status="error">
              <p>
                This fact table does not have any numeric columns. Please select
                a different fact table.
              </p>
            </Callout>
          ) : null}
          {stringColumns.size > 0 && !stringColumnOptions.length ? (
            <Callout status="error">
              <p>
                This fact table does not have any string columns to filter on.
                Please select a different fact table.
              </p>
            </Callout>
          ) : null}
        </>
      )}
      {[...numericColumns]
        .filter((c) => !c.startsWith("$$"))
        .map((k) => {
          if (!numericColumnOptions.length) return null;
          return (
            <SelectField
              key={k}
              label={`Column: ${k}`}
              value={numericColumnMap[k] || ""}
              onChange={(column) => {
                setNumericColumnMap({ ...numericColumnMap, [k]: column });
              }}
              options={numericColumnOptions}
              disabled={!factTable}
              required
              placeholder="Select..."
            />
          );
        })}
      {[...stringColumns]
        .filter((c) => !c.startsWith("$$"))
        .map((k) => {
          if (!stringColumnOptions.length) return null;
          return (
            <SelectField
              key={k}
              label={`Column: ${k}`}
              value={stringColumnMap[k] || ""}
              onChange={(column) => {
                setStringColumnMap({ ...stringColumnMap, [k]: column });
              }}
              options={stringColumnOptions}
              disabled={!factTable}
              required
              placeholder="Select..."
            />
          );
        })}
    </Modal>
  );
}

export default function FactMetricModal({
  close,
  initialFactTable,
  existing,
  duplicate = false,
  fromTemplate = false,
  showAdvancedSettings,
  onSave,
  switchToLegacy,
  source,
  datasource,
}: Props) {
  const { metricDefaults } = useOrganizationMetricDefaults();

  const settings = useOrgSettings();

  const { hasCommercialFeature } = useUser();

  // TODO: We may want to hide this from non-technical users in the future
  const showSQLPreview = true;

  const [showExperimentSQL, setShowExperimentSQL] = useState(false);

  const {
    datasources,
    getDatasourceById,
    project,
    getFactTableById,
    mutateDefinitions,
  } = useDefinitions();

  const { apiCall } = useAuth();

  const validDatasources = datasources
    .filter((d) => isProjectListValidForProject(d.projects, project))
    .filter((d) => d.properties?.queryLanguage === "sql")
    .filter((d) => !datasource || d.id === datasource);

  const defaultValues = getDefaultFactMetricProps({
    datasources,
    metricDefaults,
    existing,
    settings,
    project,
    initialFactTable: initialFactTable
      ? getFactTableById(initialFactTable) || undefined
      : undefined,
  });

  // Multiple percent values by 100 for the UI
  // These are corrected in the submit method later
  defaultValues.winRisk = defaultValues.winRisk * 100;
  defaultValues.loseRisk = defaultValues.loseRisk * 100;
  defaultValues.minPercentChange = defaultValues.minPercentChange * 100;
  defaultValues.maxPercentChange = defaultValues.maxPercentChange * 100;

  const form = useForm<CreateFactMetricProps>({
    defaultValues,
  });

  const selectedDataSource = getDatasourceById(form.watch("datasource"));

  const [advancedOpen, setAdvancedOpen] = useState(
    showAdvancedSettings || false
  );

  const type = form.watch("metricType");

  const riskError =
    form.watch("loseRisk") < form.watch("winRisk")
      ? "The acceptable risk percentage cannot be higher than the too risky percentage"
      : "";

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;

  if (["ratio", "quantile"].includes(type)) {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>{`Not available for ${type} metrics.`}</>
    );
  }

  const regressionAdjustmentDays =
    form.watch("regressionAdjustmentDays") ||
    DEFAULT_REGRESSION_ADJUSTMENT_DAYS;

  const regressionAdjustmentDaysHighlightColor =
    regressionAdjustmentDays > 28 || regressionAdjustmentDays < 7
      ? "#e27202"
      : "";
  const regressionAdjustmentDaysWarningMsg =
    regressionAdjustmentDays > 28
      ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
      : regressionAdjustmentDays < 7
      ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
      : "";

  const isNew = !existing || duplicate || fromTemplate;
  const initialType = existing?.metricType;
  useEffect(() => {
    if (isNew) {
      track("Viewed Create Fact Metric Modal", { source });
    } else {
      track("Viewed Edit Fact Metric Modal", {
        type: initialType,
        source,
      });
    }
  }, [isNew, initialType, source]);

  const quantileSettings = form.watch("quantileSettings") || {
    type: "event",
    quantile: 0.5,
    ignoreZeros: false,
  };

  const quantileMetricsAvailableForDatasource =
    selectedDataSource?.properties?.hasQuantileTesting;
  const hasQuantileMetricCommercialFeature = hasCommercialFeature(
    "quantile-metrics"
  );
  const hasRetentionMetricCommercialFeature = hasCommercialFeature(
    "retention-metrics"
  );

  const numerator = form.watch("numerator");
  const numeratorFactTable = getFactTableById(numerator?.factTableId || "");
  const denominator = form.watch("denominator");
  const windowSettings = form.watch("windowSettings");

  // Must have at least one numeric column to use event-level quantile metrics
  // For user-level quantiles, there is the option to count rows so it's always available
  const canUseEventQuantile = getNumericColumns(numeratorFactTable).length > 0;

  const quantileMetricType = type !== "quantile" ? "" : quantileSettings.type;

  const { sql, experimentSQL, denominatorSQL } = getPreviewSQL({
    type,
    quantileSettings,
    windowSettings,
    numerator,
    denominator,
    numeratorFactTable,
    denominatorFactTable: getFactTableById(denominator?.factTableId || ""),
  });

  const setDatasource = (datasource: string) => {
    form.setValue("datasource", datasource);
  };

  if (fromTemplate && !form.watch("numerator").factTableId) {
    return (
      <FieldMappingModal
        factMetric={defaultValues}
        onSave={(metric) => {
          form.reset(metric);
        }}
        close={close}
      />
    );
  }

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header={!isNew ? "Edit Metric" : "Create Fact Table Metric"}
      bodyClassName="p-0"
      close={close}
      submit={form.handleSubmit(async (values) => {
        if (values.denominator && !values.denominator.factTableId) {
          values.denominator = null;
        }

        if (values.priorSettings === undefined) {
          values.priorSettings = {
            override: false,
            proper: false,
            mean: 0,
            stddev: DEFAULT_PROPER_PRIOR_STDDEV,
          };
        }

        if (values.metricType === "ratio" && !values.denominator)
          throw new Error("Must select a denominator for ratio metrics");

        // reset denominator for non-ratio metrics
        if (values.metricType !== "ratio" && values.denominator) {
          values.denominator = null;
        }

        // reset numerator for proportion/retention metrics
        if (
          (values.metricType === "proportion" ||
            values.metricType === "retention") &&
          values.numerator.column !== "$$distinctUsers"
        ) {
          values.numerator.column = "$$distinctUsers";
        }

        if (values.cappingSettings?.type) {
          if (!values.cappingSettings.value) {
            throw new Error("Capped Value cannot be 0");
          }
        }

        if (values.numerator.aggregateFilterColumn) {
          // Validate that the value is correct
          getAggregateFilters({
            columnRef: values.numerator,
            column: values.numerator.aggregateFilterColumn,
            ignoreInvalid: false,
          });
        }

        if (
          values.numerator.aggregateFilterColumn &&
          values.metricType === "ratio"
        ) {
          if (values.numerator.column !== "$$distinctUsers") {
            values.numerator.aggregateFilterColumn = "";
          } else {
            if (values.cappingSettings?.type) {
              throw new Error(
                "Cannot specify both Percentile Capping and a User Filter. Please remove one of them."
              );
            }
          }
        }

        if (!selectedDataSource) throw new Error("Must select a data source");

        // Correct percent values
        values.winRisk = values.winRisk / 100;
        values.loseRisk = values.loseRisk / 100;
        values.minPercentChange = values.minPercentChange / 100;
        values.maxPercentChange = values.maxPercentChange / 100;

        // Anonymized telemetry props
        // Will help us measure which settings are being used so we can optimize the UI
        const trackProps = {
          type: values.metricType,
          source,
          capping: values.cappingSettings.type,
          conversion_window: values.windowSettings.type
            ? `${values.windowSettings.windowValue} ${values.windowSettings.windowUnit}`
            : "none",
          numerator_agg:
            values.numerator.column === "$$count"
              ? "count"
              : values.numerator.column === "$$distinctUsers"
              ? "distinct_users"
              : values.numerator.aggregation || "sum",
          numerator_filters: values.numerator.filters.length,
          denominator_agg:
            values.denominator?.column === "$$count"
              ? "count"
              : values.denominator?.column === "$$distinctUsers"
              ? "distinct_users"
              : values.denominator?.column
              ? values.denominator?.aggregation || "sum"
              : "none",
          denominator_filters: values.denominator?.filters?.length || 0,
          ratio_same_fact_table:
            values.metricType === "ratio" &&
            values.numerator.factTableId === values.denominator?.factTableId,
        };

        if (!isNew) {
          const updatePayload: UpdateFactMetricProps = omit(values, [
            "datasource",
          ]);
          await apiCall(`/fact-metrics/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(updatePayload),
          });
          track("Edit Fact Metric", trackProps);
          await mutateDefinitions();
        } else {
          const createPayload: CreateFactMetricProps = {
            ...values,
            projects:
              numeratorFactTable?.projects || selectedDataSource.projects || [],
          };

          await apiCall<{
            factMetric: FactMetricInterface;
          }>(`/fact-metrics`, {
            method: "POST",
            body: JSON.stringify(createPayload),
          });
          track("Create Fact Metric", trackProps);
          await mutateDefinitions();

          onSave && onSave();
        }
      })}
      size={showSQLPreview ? "max" : "lg"}
    >
      <div className="d-flex">
        <div className="px-3 py-4 flex-1">
          {showSQLPreview ? <h3>Enter Details</h3> : null}
          {switchToLegacy && (
            <Callout status="info" mb="3">
              You are creating a Fact Table Metric.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  switchToLegacy();
                }}
              >
                Switch to legacy SQL <FaArrowRight />
              </a>
            </Callout>
          )}
          <Field
            label="Metric Name"
            {...form.register("name")}
            autoFocus
            required
          />
          {!existing && !initialFactTable && (
            <SelectField
              label="Data Source"
              value={form.watch("datasource")}
              onChange={(v) => {
                form.setValue("datasource", v);
                form.setValue("numerator", {
                  factTableId: "",
                  column: "",
                  filters: [],
                });
                form.setValue("denominator", {
                  factTableId: "",
                  column: "",
                  filters: [],
                });
              }}
              options={validDatasources.map((d) => {
                const defaultDatasource = d.id === settings.defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  } ${defaultDatasource ? " (default)" : ""}`,
                };
              })}
              className="portal-overflow-ellipsis"
              name="datasource"
              placeholder="Select..."
            />
          )}
          {selectedDataSource && (
            <>
              <ButtonSelectField
                label={
                  <>
                    Type of Metric{" "}
                    <Tooltip
                      body={
                        <div>
                          <div className="mb-2">
                            <strong>Proportion</strong> metrics calculate a
                            simple conversion rate - the proportion of users in
                            your experiment who are in a specific fact table.
                          </div>
                          <div className="mb-2">
                            <strong>Retention</strong> metrics calculate a
                            proportion of users who are in a table at least X
                            days or hours after experiment exposure or some
                            other event timestamp.
                          </div>
                          <div className="mb-2">
                            <strong>Mean</strong> metrics calculate the average
                            value of a numeric column in a fact table.
                          </div>
                          <div>
                            <strong>Ratio</strong> metrics allow you to
                            calculate a complex value by dividing two different
                            numeric columns in your fact tables.
                          </div>
                          <div className="mb-2">
                            <strong>Quantile</strong> metrics calculate the
                            value at a specific percentile of a numeric column
                            in a fact table.
                            {!quantileMetricsAvailableForDatasource
                              ? " Quantile metrics are not available for MySQL data sources."
                              : ""}
                          </div>
                        </div>
                      }
                    />
                  </>
                }
                value={type}
                setValue={(type) => {
                  if (
                    type === "quantile" &&
                    (!quantileMetricsAvailableForDatasource ||
                      !hasQuantileMetricCommercialFeature)
                  ) {
                    return;
                  }
                  if (
                    type === "retention" &&
                    !hasRetentionMetricCommercialFeature
                  ) {
                    return;
                  }

                  // always reset delay value when switching away from retention
                  if (
                    form.getValues("metricType") === "retention" &&
                    type !== "retention"
                  ) {
                    form.setValue("windowSettings.delayValue", 0);
                    form.setValue("windowSettings.delayUnit", "hours");
                  }

                  form.setValue("metricType", type as FactMetricType);

                  // Set better defaults for retention metrics
                  if (type === "retention") {
                    if (form.getValues("windowSettings.delayValue") === 0) {
                      form.setValue("windowSettings.delayValue", 7);
                      form.setValue("windowSettings.delayUnit", "days");
                    }
                  }

                  if (type === "quantile") {
                    if (!canUseEventQuantile) {
                      quantileSettings.type = "unit";
                    }

                    form.setValue("quantileSettings", quantileSettings);
                    // capping off for quantile metrics
                    form.setValue("cappingSettings.type", "");

                    if (
                      quantileSettings.type === "event" &&
                      numerator.column.startsWith("$$")
                    ) {
                      const column = getNumericColumns(numeratorFactTable)[0];
                      form.setValue("numerator", {
                        ...numerator,
                        column: column?.column || "",
                      });
                    }
                  }

                  // When switching to ratio, reset the denominator value
                  if (type === "ratio" && !form.watch("denominator")) {
                    form.setValue("denominator", {
                      factTableId:
                        numerator.factTableId || initialFactTable || "",
                      column: "$$count",
                      filters: [],
                    });
                  }

                  // When switching to ratio and using `absolute` capping, turn it off (only percentile supported)
                  if (
                    type === "ratio" &&
                    form.watch("cappingSettings.type") === "absolute"
                  ) {
                    form.setValue("cappingSettings.type", "");
                  }
                }}
                options={[
                  {
                    value: "proportion",
                    label: "Proportion",
                  },
                  {
                    value: "retention",
                    label: (
                      <>
                        <PremiumTooltip commercialFeature="retention-metrics">
                          Retention
                        </PremiumTooltip>
                      </>
                    ),
                  },
                  {
                    value: "mean",
                    label: "Mean",
                  },
                  {
                    value: "ratio",
                    label: "Ratio",
                  },
                  {
                    value: "quantile",
                    label: (
                      <>
                        <PremiumTooltip
                          commercialFeature="quantile-metrics"
                          body={
                            !quantileMetricsAvailableForDatasource
                              ? "Quantile metrics are not available for MySQL data sources"
                              : ""
                          }
                        >
                          Quantile
                        </PremiumTooltip>
                      </>
                    ),
                  },
                ]}
              />
              {type === "proportion" ? (
                <div>
                  <ColumnRefSelector
                    value={numerator}
                    setValue={(numerator) =>
                      form.setValue("numerator", numerator)
                    }
                    setDatasource={setDatasource}
                    datasource={selectedDataSource}
                    disableFactTableSelector={!!initialFactTable}
                    supportsAggregatedFilter={true}
                    allowChangingDatasource={!datasource}
                    key={selectedDataSource.id}
                  />
                  <HelperText status="info">
                    The final metric value will be the percent of users in the
                    experiment that match the above criteria.
                  </HelperText>
                </div>
              ) : type === "retention" ? (
                <div>
                  <div className="form-group">
                    <label>Retention Event</label>
                    <ColumnRefSelector
                      value={numerator}
                      setValue={(numerator) =>
                        form.setValue("numerator", numerator)
                      }
                      setDatasource={setDatasource}
                      datasource={selectedDataSource}
                      disableFactTableSelector={!!initialFactTable}
                      supportsAggregatedFilter={true}
                      allowChangingDatasource={!datasource}
                      key={selectedDataSource.id}
                    />
                  </div>
                  <div className="form-group">
                    <RetentionWindowSelector form={form} />
                  </div>
                  <HelperText status="info">
                    The final metric value will be the percent of users in the
                    experiment that match the retention event at least
                    {` ${windowSettings?.windowValue || "X"} ${
                      windowSettings?.windowUnit || "days"
                    } `}
                    after experiment exposure.
                  </HelperText>
                </div>
              ) : type === "mean" ? (
                <div>
                  <label>Per-User Value</label>
                  <ColumnRefSelector
                    value={numerator}
                    setValue={(numerator) =>
                      form.setValue("numerator", numerator)
                    }
                    includeColumn={true}
                    setDatasource={setDatasource}
                    datasource={selectedDataSource}
                    disableFactTableSelector={!!initialFactTable}
                    allowChangingDatasource={!datasource}
                    key={selectedDataSource.id}
                  />
                  <HelperText status="info">
                    The final metric value will be the average per-user value
                    for all users in the experiment. Any user without a matching
                    row will have a value of 0 and will still contribute to this
                    average.
                  </HelperText>
                </div>
              ) : type === "quantile" ? (
                <div>
                  <div className="form-group">
                    <Toggle
                      id="quantileTypeSelector"
                      label="Aggregate by User First"
                      value={
                        !canUseEventQuantile ||
                        quantileSettings.type !== "event"
                      }
                      setValue={(unit) => {
                        // Event-level quantiles must select a numeric column
                        if (!unit && numerator?.column?.startsWith("$$")) {
                          const column = getNumericColumns(
                            numeratorFactTable
                          )[0];
                          form.setValue("numerator", {
                            ...numerator,
                            column: column?.column || "",
                          });
                        }
                        form.setValue("quantileSettings", {
                          ...quantileSettings,
                          type: unit ? "unit" : "event",
                        });
                      }}
                      disabled={!canUseEventQuantile}
                    />
                    <label
                      htmlFor="quantileTypeSelector"
                      className="ml-2 cursor-pointer"
                    >
                      Aggregate by Experiment User before taking quantile?
                    </label>
                  </div>
                  <label>
                    {quantileSettings.type === "unit"
                      ? "Per-User Value"
                      : "Event Value"}
                  </label>
                  <ColumnRefSelector
                    value={numerator}
                    setValue={(numerator) =>
                      form.setValue("numerator", numerator)
                    }
                    includeColumn={true}
                    aggregationType={quantileSettings.type}
                    setDatasource={setDatasource}
                    datasource={selectedDataSource}
                    disableFactTableSelector={!!initialFactTable}
                    allowChangingDatasource={!datasource}
                    key={selectedDataSource.id}
                    extraField={
                      <>
                        {form
                          .watch("numerator")
                          ?.column?.startsWith("$$") ? undefined : (
                          <div className="col-auto">
                            <div className="form-group">
                              <label htmlFor="quantileIgnoreZeros">
                                Ignore Zeros{" "}
                                <Tooltip
                                  body={`If the ${
                                    quantileSettings.type === "unit"
                                      ? "per-user"
                                      : "rows"
                                  } value is zero (or null), exclude it from the quantile calculation`}
                                />
                              </label>
                              <div style={{ padding: "6px 0" }}>
                                <Toggle
                                  id="quantileIgnoreZeros"
                                  value={quantileSettings.ignoreZeros}
                                  setValue={(ignoreZeros) =>
                                    form.setValue("quantileSettings", {
                                      ...quantileSettings,
                                      ignoreZeros,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="col-auto">
                          <QuantileSelector
                            value={quantileSettings}
                            setValue={(quantileSettings) =>
                              form.setValue(
                                "quantileSettings",
                                quantileSettings
                              )
                            }
                          />
                        </div>
                      </>
                    }
                  />
                  <HelperText status="info">
                    The final metric value will be the selected quantile
                    {quantileSettings.type === "unit"
                      ? " of all aggregated experiment user values"
                      : " of all rows that are matched to experiment users"}
                    {quantileSettings.ignoreZeros ? ", ignoring zeros" : ""}.
                  </HelperText>
                </div>
              ) : type === "ratio" ? (
                <>
                  <div className="form-group">
                    <label>Numerator</label>
                    <ColumnRefSelector
                      value={numerator}
                      setValue={(numerator) =>
                        form.setValue("numerator", numerator)
                      }
                      includeColumn={true}
                      includeCountDistinct={true}
                      setDatasource={setDatasource}
                      datasource={selectedDataSource}
                      disableFactTableSelector={!!initialFactTable}
                      supportsAggregatedFilter={
                        numerator.column === "$$distinctUsers"
                      }
                      allowChangingDatasource={!datasource}
                      key={selectedDataSource.id}
                    />
                  </div>
                  <div className="form-group">
                    <label>Denominator</label>
                    <ColumnRefSelector
                      value={
                        denominator || {
                          column: "$$count",
                          factTableId: "",
                          filters: [],
                        }
                      }
                      setValue={(denominator) =>
                        form.setValue("denominator", denominator)
                      }
                      includeColumn={true}
                      includeCountDistinct={true}
                      setDatasource={setDatasource}
                      allowChangingDatasource={false}
                      datasource={selectedDataSource}
                      key={selectedDataSource.id}
                    />
                  </div>

                  <HelperText status="info">
                    The final metric value will be the Numerator divided by the
                    Denominator. We use the Delta Method to provide an accurate
                    estimation of variance.
                  </HelperText>
                </>
              ) : (
                <p>Select a metric type above</p>
              )}

              <MetricWindowSettingsForm form={form} type={type} />

              {!advancedOpen && (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setAdvancedOpen(true);
                    track("View Advanced Fact Metric Settings", {
                      source,
                    });
                  }}
                >
                  Show Advanced Settings
                </a>
              )}
              {advancedOpen && (
                <Tabs defaultValue="query">
                  <TabsList>
                    <TabsTrigger value="query">Query Settings</TabsTrigger>
                    <TabsTrigger value="display">Display Settings</TabsTrigger>
                    <div className="ml-auto">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setAdvancedOpen(false);
                        }}
                        style={{ verticalAlign: "middle" }}
                        title="Hide advanced settings"
                      >
                        <FaTimes /> Hide
                      </a>
                    </div>
                  </TabsList>

                  <Box py="3">
                    <TabsContent value="query">
                      {type !== "retention" ? (
                        <MetricDelaySettings form={form} />
                      ) : null}
                      {type !== "quantile" &&
                      type !== "proportion" &&
                      type !== "retention" ? (
                        <MetricCappingSettingsForm
                          form={form}
                          datasourceType={selectedDataSource.type}
                          metricType={type}
                        />
                      ) : null}

                      <MetricPriorSettingsForm
                        priorSettings={form.watch("priorSettings")}
                        setPriorSettings={(priorSettings) =>
                          form.setValue("priorSettings", priorSettings)
                        }
                        metricDefaults={metricDefaults}
                      />

                      <PremiumTooltip commercialFeature="regression-adjustment">
                        <label className="mb-1">
                          <GBCuped /> Regression Adjustment (CUPED)
                        </label>
                      </PremiumTooltip>
                      <div className="px-3 py-2 pb-0 mb-2 border rounded">
                        {regressionAdjustmentAvailableForMetric ? (
                          <>
                            <Checkbox
                              label="Override organization-level settings"
                              value={form.watch("regressionAdjustmentOverride")}
                              setValue={(v) =>
                                form.setValue(
                                  "regressionAdjustmentOverride",
                                  v === true
                                )
                              }
                              disabled={!hasRegressionAdjustmentFeature}
                            />
                            <div
                              style={{
                                display: form.watch(
                                  "regressionAdjustmentOverride"
                                )
                                  ? "block"
                                  : "none",
                              }}
                            >
                              <div className="d-flex my-2 border-bottom"></div>
                              <div className="form-group mt-3 mb-0 mr-2 form-inline">
                                <label
                                  className="mr-1"
                                  htmlFor="toggle-regressionAdjustmentEnabled"
                                >
                                  Apply regression adjustment for this metric
                                </label>
                                <Toggle
                                  id={"toggle-regressionAdjustmentEnabled"}
                                  value={
                                    !!form.watch("regressionAdjustmentEnabled")
                                  }
                                  setValue={(value) => {
                                    form.setValue(
                                      "regressionAdjustmentEnabled",
                                      value
                                    );
                                  }}
                                  disabled={!hasRegressionAdjustmentFeature}
                                />
                                <small className="form-text text-muted">
                                  (organization default:{" "}
                                  {settings.regressionAdjustmentEnabled
                                    ? "On"
                                    : "Off"}
                                  )
                                </small>
                              </div>
                              <div
                                className="form-group mt-3 mb-1 mr-2"
                                style={{
                                  opacity: form.watch(
                                    "regressionAdjustmentEnabled"
                                  )
                                    ? "1"
                                    : "0.5",
                                }}
                              >
                                <Field
                                  label="Pre-exposure lookback period (days)"
                                  type="number"
                                  style={{
                                    borderColor: regressionAdjustmentDaysHighlightColor,
                                    backgroundColor: regressionAdjustmentDaysHighlightColor
                                      ? regressionAdjustmentDaysHighlightColor +
                                        "15"
                                      : "",
                                  }}
                                  className="ml-2"
                                  containerClassName="mb-0 form-inline"
                                  inputGroupClassName="d-inline-flex w-150px"
                                  append="days"
                                  min="0"
                                  max="100"
                                  disabled={!hasRegressionAdjustmentFeature}
                                  helpText={
                                    <>
                                      <span className="ml-2">
                                        (organization default:{" "}
                                        {settings.regressionAdjustmentDays ??
                                          DEFAULT_REGRESSION_ADJUSTMENT_DAYS}
                                        )
                                      </span>
                                    </>
                                  }
                                  {...form.register(
                                    "regressionAdjustmentDays",
                                    {
                                      valueAsNumber: true,
                                      validate: (v) => {
                                        v = v || 0;
                                        return !(v <= 0 || v > 100);
                                      },
                                    }
                                  )}
                                />
                                {regressionAdjustmentDaysWarningMsg && (
                                  <small
                                    style={{
                                      color: regressionAdjustmentDaysHighlightColor,
                                    }}
                                  >
                                    {regressionAdjustmentDaysWarningMsg}
                                  </small>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="text-muted">
                            <FaTimes className="text-danger" />{" "}
                            {regressionAdjustmentAvailableForMetricReason}
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="display">
                      <SelectField
                        label="What is the goal?"
                        value={form.watch("inverse") ? "1" : "0"}
                        onChange={(v) => {
                          form.setValue("inverse", v === "1");
                        }}
                        options={[
                          {
                            value: "0",
                            label: `Increase the metric value`,
                          },
                          {
                            value: "1",
                            label: `Decrease the metric value`,
                          },
                        ]}
                        helpText="Some metrics like 'page load time' you actually want to decrease instead of increase"
                      />
                      <div className="form-group">
                        <label>{`Minimum ${
                          quantileMetricType
                            ? `${capitalizeFirstLetter(
                                quantileMetricType
                              )} Count`
                            : `${
                                type === "ratio" ? "Numerator" : "Metric"
                              } Total`
                        }`}</label>
                        <input
                          type="number"
                          className="form-control"
                          {...form.register("minSampleSize", {
                            valueAsNumber: true,
                          })}
                        />
                        <small className="text-muted">
                          The{" "}
                          {type === "proportion"
                            ? "number of conversions"
                            : type === "ratio"
                            ? "total numerator sum"
                            : quantileMetricType
                            ? `number of ${quantileMetricType}s`
                            : "total metric sum"}{" "}
                          required in an experiment variation before showing
                          results (default{" "}
                          {type === "proportion"
                            ? metricDefaults.minimumSampleSize
                            : formatNumber(metricDefaults.minimumSampleSize)}
                          )
                        </small>
                      </div>
                      <Field
                        label="Max Percent Change"
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("maxPercentChange", {
                          valueAsNumber: true,
                        })}
                        helpText={`An experiment that changes the metric by more than this percent will
            be flagged as suspicious (default ${
              metricDefaults.maxPercentageChange * 100
            })`}
                      />
                      <Field
                        label="Min Percent Change"
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("minPercentChange", {
                          valueAsNumber: true,
                        })}
                        helpText={`An experiment that changes the metric by less than this percent will be
            considered a draw (default ${
              metricDefaults.minPercentageChange * 100
            })`}
                      />

                      <RiskThresholds
                        winRisk={form.watch("winRisk")}
                        loseRisk={form.watch("loseRisk")}
                        winRiskRegisterField={form.register("winRisk")}
                        loseRiskRegisterField={form.register("loseRisk")}
                        riskError={riskError}
                      />
                    </TabsContent>
                  </Box>
                </Tabs>
              )}
            </>
          )}
        </div>
        {showSQLPreview && (
          <div
            className="bg-light px-3 py-4 flex-1 border-left d-none d-md-block"
            style={{
              width: "50%",
              maxWidth: "600px",
            }}
          >
            <h3>Live SQL Preview</h3>
            <p>
              <em>
                This has been highly simplified for readability. Advanced
                settings are not reflected.
              </em>
            </p>
            <div className="mb-3">
              <strong>
                Metric Value{" "}
                {type !== "quantile" || quantileSettings.type === "unit"
                  ? `(per user)`
                  : ""}
              </strong>
              <Code
                language="sql"
                code={sql}
                className="bg-light"
                filename={denominatorSQL ? "Numerator" : undefined}
              />
              {denominatorSQL ? (
                <Code
                  language="sql"
                  code={denominatorSQL}
                  className="bg-light"
                  filename={"Denominator"}
                />
              ) : null}
            </div>
            <div>
              <div className="d-flex align-items-center">
                <strong>Experiment Results</strong>
                <a
                  href="#"
                  className="ml-2 small"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowExperimentSQL(!showExperimentSQL);
                  }}
                >
                  {showExperimentSQL ? "hide" : "show"}
                </a>
              </div>
              <div
                style={{
                  maxHeight: showExperimentSQL ? "500px" : "0",
                  opacity: showExperimentSQL ? "1" : "0",
                  overflow: "hidden",
                  transition: "max-height 0.3s, opacity 0.3s",
                }}
              >
                <Code
                  language="sql"
                  code={experimentSQL}
                  className="bg-light"
                />
              </div>
            </div>

            {type ? null : type === "proportion" ? (
              <Callout status="info">
                The final metric value will be the percent of all users in the
                experiment who have at least 1 matching row.
              </Callout>
            ) : type === "mean" ? (
              <Callout status="info">
                The final metric value will be the average per-user value for
                all users in the experiment. Any user without a matching row
                will have a value of <code>0</code> and will still contribute to
                this average.
              </Callout>
            ) : type === "quantile" ? (
              <Callout status="info">
                The final metric value will be the selected quantile
                {quantileSettings.type === "unit"
                  ? " of all aggregated experiment user values"
                  : " of all rows that are matched to experiment users"}
                {quantileSettings.ignoreZeros ? ", ignoring zeros" : ""}.
              </Callout>
            ) : type === "ratio" ? (
              <Callout status="info">
                The final metric value will be the Numerator divided by the
                Denominator. We use the Delta Method to provide an accurate
                estimation of variance.
              </Callout>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
