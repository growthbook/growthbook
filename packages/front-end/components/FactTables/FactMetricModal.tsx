import { useForm } from "react-hook-form";
import { FaTimes } from "react-icons/fa";
import { ReactElement, useEffect, useState } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  ColumnRef,
  UpdateFactMetricProps,
  MetricQuantileSettings,
  FactMetricType,
} from "back-end/types/fact-table";
import { isProjectListValidForProject } from "shared/util";
import omit from "lodash/omit";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatNumber } from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import RiskThresholds from "@/components/Metrics/MetricForm/RiskThresholds";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBArrowLeft, GBCuped } from "@/components/Icons";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "@/components/Metrics/MetricForm/MetricCappingSettingsForm";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { MetricDelayHours } from "@/components/Metrics/MetricForm/MetricDelayHours";
import { AppFeatures } from "@/types/app-features";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";

export interface Props {
  close?: () => void;
  initialFactTable?: string;
  existing?: FactMetricInterface;
  showAdvancedSettings?: boolean;
  onSave?: () => void;
  goBack?: () => void;
  source: string;
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

function ColumnRefSelector({
  value,
  setValue,
  includeCountDistinct,
  aggregationType = "unit",
  includeColumn,
  datasource,
  disableFactTableSelector,
  extraField,
}: {
  setValue: (ref: ColumnRef) => void;
  value: ColumnRef;
  includeCountDistinct?: boolean;
  includeColumn?: boolean;
  aggregationType?: "unit" | "event";
  datasource: string;
  disableFactTableSelector?: boolean;
  extraField?: ReactElement;
}) {
  const { getFactTableById, factTables } = useDefinitions();

  let factTable = getFactTableById(value.factTableId);
  if (factTable?.datasource !== datasource) factTable = null;

  const columnOptions: SingleValue[] = (factTable?.columns || [])
    .filter(
      (col) =>
        !col.deleted &&
        col.column !== "timestamp" &&
        !factTable?.userIdTypes?.includes(col.column)
    )
    .filter((col) => col.datatype === "number")
    .map((col) => ({
      label: col.name,
      value: col.column,
    }));

  const specialColumnOptions: SingleValue[] = [];
  if (includeCountDistinct && aggregationType === "unit") {
    specialColumnOptions.push({
      label: `Unique Users`,
      value: "$$distinctUsers",
    });
  }
  if (aggregationType === "unit") {
    specialColumnOptions.push({
      label: "Count of Rows",
      value: "$$count",
    });
  }

  return (
    <div className="appbox px-3 pt-3 bg-light">
      <div className="row align-items-center">
        <div className="col-auto">
          <SelectField
            label={"Fact Table"}
            disabled={disableFactTableSelector}
            value={value.factTableId}
            onChange={(factTableId) =>
              setValue({
                factTableId,
                column: value.column?.match(/^\$\$/) ? value.column : "$$count",
                filters: [],
              })
            }
            options={factTables
              .filter((t) => t.datasource === datasource)
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
        {factTable && factTable.filters.length > 0 ? (
          <div className="col-auto">
            <MultiSelectField
              label={
                <>
                  Included Rows{" "}
                  <Tooltip body="Only rows that satisfy ALL selected filters will be included" />
                </>
              }
              value={value.filters}
              onChange={(filters) => setValue({ ...value, filters })}
              options={factTable.filters.map((f) => ({
                label: f.name,
                value: f.id,
              }))}
              placeholder="All Rows"
              closeMenuOnSelect={true}
              formatOptionLabel={({ value, label }) => {
                const filter = factTable?.filters.find((f) => f.id === value);
                if (filter) {
                  return (
                    <>
                      {filter.name}
                      <OfficialBadge
                        managedBy={filter.managedBy}
                        type="filter"
                      />
                    </>
                  );
                }
                return label;
              }}
            />
          </div>
        ) : null}
        {includeColumn && (
          <div className="col-auto">
            <SelectField
              label="Value"
              value={value.column}
              onChange={(column) => setValue({ ...value, column })}
              sort={false}
              formatGroupLabel={({ label }) => (
                <div className="pt-2 pb-1 border-bottom">{label}</div>
              )}
              options={
                specialColumnOptions.length > 0
                  ? [
                      {
                        label: "Special",
                        options: specialColumnOptions,
                      },
                      {
                        label: "Columns",
                        options: columnOptions,
                      },
                    ]
                  : columnOptions
              }
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
                label={
                  <>
                    Aggregation{" "}
                    <Tooltip body="Only SUM is supported today, but more aggregation types may be added in the future." />
                  </>
                }
                value="sum"
                onChange={() => {
                  /*do nothing*/
                }}
                disabled
                options={[{ label: "Sum", value: "sum" }]}
              />
            </div>
          )}
        {extraField && <div className="col-auto">{extraField}</div>}
      </div>
    </div>
  );
}

export default function FactMetricModal({
  close,
  initialFactTable,
  existing,
  showAdvancedSettings,
  onSave,
  goBack,
  source,
}: Props) {
  const growthbook = useGrowthBook<AppFeatures>();

  const { metricDefaults } = useOrganizationMetricDefaults();

  const settings = useOrgSettings();

  const { hasCommercialFeature } = useUser();

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
    .filter((d) => d.properties?.queryLanguage === "sql");

  const form = useForm<CreateFactMetricProps>({
    defaultValues: {
      name: existing?.name || "",
      description: existing?.description || "",
      tags: existing?.tags || [],
      metricType: existing?.metricType || "proportion",
      numerator: existing?.numerator || {
        factTableId: initialFactTable || "",
        column: "$$count",
        filters: [],
      },
      projects: [],
      denominator: existing?.denominator || null,
      datasource:
        existing?.datasource ||
        getNewExperimentDatasourceDefaults(
          datasources,
          settings,
          project,
          initialFactTable
            ? { datasource: getFactTableById(initialFactTable)?.datasource }
            : {}
        ).datasource,
      inverse: existing?.inverse || false,
      cappingSettings: existing?.cappingSettings || {
        type: "",
        value: 0,
      },
      quantileSettings: existing?.quantileSettings || null,
      windowSettings: existing?.windowSettings || {
        type: DEFAULT_FACT_METRIC_WINDOW,
        delayHours: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        windowUnit: "days",
        windowValue: 3,
      },
      winRisk: (existing?.winRisk || DEFAULT_WIN_RISK_THRESHOLD) * 100,
      loseRisk: (existing?.loseRisk || DEFAULT_LOSE_RISK_THRESHOLD) * 100,
      minPercentChange:
        (existing?.minPercentChange || metricDefaults.minPercentageChange) *
        100,
      maxPercentChange:
        (existing?.maxPercentChange || metricDefaults.maxPercentageChange) *
        100,
      minSampleSize:
        existing?.minSampleSize || metricDefaults.minimumSampleSize,
      regressionAdjustmentOverride:
        existing?.regressionAdjustmentOverride || false,
      regressionAdjustmentEnabled:
        existing?.regressionAdjustmentEnabled ||
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      regressionAdjustmentDays:
        existing?.regressionAdjustmentDays ||
        (settings.regressionAdjustmentDays ??
          DEFAULT_REGRESSION_ADJUSTMENT_DAYS),
      priorSettings: existing?.priorSettings || metricDefaults.priorSettings,
    },
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

  const isNew = !existing;
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

  const quantileMetricFlag = growthbook && growthbook.isOn("quantile-metrics");
  const quantileMetricsAvailableForDatasource =
    quantileMetricFlag && selectedDataSource?.properties?.hasQuantileTesting;
  const hasQuantileMetricCommercialFeature =
    quantileMetricFlag && hasCommercialFeature("quantile-metrics");

  const numeratorFactTable = getFactTableById(
    form.watch("numerator.factTableId")
  );
  // Must have at least one numeric column to use event-level quantile metrics
  // For user-level quantiles, there is the option to count rows so it's always available
  const canUseEventQuantile = numeratorFactTable?.columns?.some(
    (c) => c.datatype === "number"
  );

  return (
    <Modal
      open={true}
      header={existing ? "Edit Metric" : "Create Fact Table Metric"}
      close={close}
      submit={form.handleSubmit(async (values) => {
        if (values.denominator && !values.denominator.factTableId) {
          values.denominator = null;
        }

        if (values.metricType === "ratio" && !values.denominator)
          throw new Error("Must select a denominator for ratio metrics");

        // reset denominator for non-ratio metrics
        if (values.metricType !== "ratio" && values.denominator) {
          values.denominator = null;
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
              : "sum",
          numerator_filters: values.numerator.filters.length,
          denominator_agg:
            values.denominator?.column === "$$count"
              ? "count"
              : values.denominator?.column === "$$distinctUsers"
              ? "distinct_users"
              : values.denominator?.column
              ? "sum"
              : "none",
          denominator_filters: values.denominator?.filters?.length || 0,
          ratio_same_fact_table:
            values.metricType === "ratio" &&
            values.numerator.factTableId === values.denominator?.factTableId,
        };

        if (existing) {
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
            projects: selectedDataSource.projects || [],
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
      size="lg"
    >
      {goBack && (
        <div className="mb-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              goBack();
            }}
          >
            <GBArrowLeft /> Go Back
          </a>
        </div>
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
              label: `${d.name}${d.description ? ` — ${d.description}` : ""} ${
                defaultDatasource ? " (default)" : ""
              }`,
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
                        <strong>Proportion</strong> metrics calculate a simple
                        conversion rate - the proportion of users in your
                        experiment who are in a specific fact table.
                      </div>
                      <div className="mb-2">
                        <strong>Mean</strong> metrics calculate the average
                        value of a numeric column in a fact table.
                      </div>
                      {quantileMetricFlag ? (
                        <div className="mb-2">
                          <strong>Quantile</strong> metrics calculate the value
                          at a specific percentile of a numeric column in a fact
                          table.
                          {!quantileMetricsAvailableForDatasource
                            ? " Quantile metrics are not available for MySQL data sources."
                            : ""}
                        </div>
                      ) : null}
                      <div>
                        <strong>Ratio</strong> metrics allow you to calculate a
                        complex value by dividing two different numeric columns
                        in your fact tables.
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
              form.setValue("metricType", type as FactMetricType);

              if (type === "quantile") {
                form.setValue("quantileSettings", quantileSettings);
                // capping off for quantile metrics
                form.setValue("cappingSettings.type", "");
              }

              // When switching to ratio, reset the denominator value
              if (type === "ratio" && !form.watch("denominator")) {
                form.setValue("denominator", {
                  factTableId:
                    form.watch("numerator").factTableId ||
                    initialFactTable ||
                    "",
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
                value: "mean",
                label: "Mean",
              },
              ...(quantileMetricFlag
                ? [
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
                  ]
                : []),
              {
                value: "ratio",
                label: "Ratio",
              },
            ]}
          />
          {type === "proportion" ? (
            <div>
              <ColumnRefSelector
                value={form.watch("numerator")}
                setValue={(numerator) => form.setValue("numerator", numerator)}
                datasource={selectedDataSource.id}
                disableFactTableSelector={!!initialFactTable}
              />
              <div className="alert alert-info">
                The final metric value will be the percent of users in the
                experiment with at least 1 matching row.
              </div>
            </div>
          ) : type === "mean" ? (
            <div>
              <label>Per-User Value</label>
              <ColumnRefSelector
                value={form.watch("numerator")}
                setValue={(numerator) => form.setValue("numerator", numerator)}
                includeColumn={true}
                datasource={selectedDataSource.id}
                disableFactTableSelector={!!initialFactTable}
              />
              <div className="alert alert-info">
                The final metric value will be the average per-user value for
                all users in the experiment. Any user without a matching row
                will have a value of <code>0</code> and will still contribute to
                this average.
              </div>
            </div>
          ) : type === "quantile" ? (
            <div>
              <div className="form-group">
                <Toggle
                  id="quantileTypeSelector"
                  label="Aggregate by User First"
                  value={
                    !canUseEventQuantile || quantileSettings.type !== "event"
                  }
                  setValue={(unit) => {
                    // Event-level quantiles must select a numeric column
                    if (
                      !unit &&
                      form.watch("numerator")?.column?.startsWith("$$")
                    ) {
                      const column = numeratorFactTable?.columns?.find(
                        (c) => c.datatype === "number"
                      );
                      form.setValue("numerator", {
                        ...form.watch("numerator"),
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
                value={form.watch("numerator")}
                setValue={(numerator) => form.setValue("numerator", numerator)}
                includeColumn={true}
                aggregationType={quantileSettings.type}
                datasource={selectedDataSource.id}
                disableFactTableSelector={!!initialFactTable}
                extraField={
                  form
                    .watch("numerator")
                    ?.column?.startsWith("$$") ? undefined : (
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
                  )
                }
              />
              <QuantileSelector
                value={quantileSettings}
                setValue={(quantileSettings) =>
                  form.setValue("quantileSettings", quantileSettings)
                }
              />
              <div className="alert alert-info">
                The final metric value will be the selected quantile
                {quantileSettings.type === "unit"
                  ? " of all aggregated experiment user values"
                  : " of all rows that are matched to experiment users"}
                {quantileSettings.ignoreZeros ? ", ignoring zeros" : ""}.
              </div>
            </div>
          ) : type === "ratio" ? (
            <>
              <div className="form-group">
                <label>Numerator</label>
                <ColumnRefSelector
                  value={form.watch("numerator")}
                  setValue={(numerator) =>
                    form.setValue("numerator", numerator)
                  }
                  includeColumn={true}
                  includeCountDistinct={true}
                  datasource={selectedDataSource.id}
                  disableFactTableSelector={!!initialFactTable}
                />
              </div>
              <div className="form-group">
                <label>Denominator</label>
                <ColumnRefSelector
                  value={
                    form.watch("denominator") || {
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
                  datasource={selectedDataSource.id}
                />
              </div>
              <div className="alert alert-info">
                The final metric value will be the Numerator divided by the
                Denominator. We use the Delta Method to provide an accurate
                estimation of variance.
              </div>
            </>
          ) : (
            <p>Select a metric type above</p>
          )}

          <MetricWindowSettingsForm form={form} />

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
            <Tabs
              navExtra={
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
              }
            >
              <Tab id="query" display="Query Settings">
                <MetricDelayHours form={form} />
                {type !== "quantile" ? (
                  <MetricCappingSettingsForm
                    form={form}
                    datasourceType={selectedDataSource.type}
                    metricType={type}
                  />
                ) : null}

                <div className="mb-1">
                  <MetricPriorSettingsForm
                    form={form}
                    metricDefaults={metricDefaults}
                  />
                </div>
                <PremiumTooltip commercialFeature="regression-adjustment">
                  <label className="mb-1">
                    <GBCuped /> Regression Adjustment (CUPED)
                  </label>
                </PremiumTooltip>
                <small className="d-block mb-1 text-muted">
                  Only applicable to frequentist analyses
                </small>
                <div className="px-3 py-2 pb-0 mb-2 border rounded">
                  {regressionAdjustmentAvailableForMetric ? (
                    <>
                      <div className="form-group mb-0 mr-0 form-inline">
                        <div className="form-inline my-1">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            {...form.register("regressionAdjustmentOverride")}
                            id={"toggle-regressionAdjustmentOverride"}
                            disabled={!hasRegressionAdjustmentFeature}
                          />
                          <label
                            className="mr-1 cursor-pointer"
                            htmlFor="toggle-regressionAdjustmentOverride"
                          >
                            Override organization-level settings
                          </label>
                        </div>
                      </div>
                      <div
                        style={{
                          display: form.watch("regressionAdjustmentOverride")
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
                            value={!!form.watch("regressionAdjustmentEnabled")}
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
                            opacity: form.watch("regressionAdjustmentEnabled")
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
                                ? regressionAdjustmentDaysHighlightColor + "15"
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
                            {...form.register("regressionAdjustmentDays", {
                              valueAsNumber: true,
                              validate: (v) => {
                                v = v || 0;
                                return !(v <= 0 || v > 100);
                              },
                            })}
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
              </Tab>
              <Tab id="display" display="Display Settings">
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
                  <label>Minimum Sample Size</label>
                  <input
                    type="number"
                    className="form-control"
                    {...form.register("minSampleSize", { valueAsNumber: true })}
                  />
                  <small className="text-muted">
                    The{" "}
                    {type === "proportion"
                      ? "number of conversions"
                      : type === "quantile"
                      ? `number of ${
                          quantileSettings.type === "unit" ? "users" : "events"
                        }`
                      : `total value`}{" "}
                    required in an experiment variation before showing results
                    (default{" "}
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
              </Tab>
            </Tabs>
          )}
        </>
      )}
    </Modal>
  );
}
