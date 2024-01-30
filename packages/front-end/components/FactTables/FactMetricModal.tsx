import { useForm } from "react-hook-form";
import { FaTimes } from "react-icons/fa";
import { useEffect, useState } from "react";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
} from "shared/constants";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  ColumnRef,
  UpdateFactMetricProps,
} from "back-end/types/fact-table";
import { isProjectListValidForProject } from "shared/util";
import omit from "lodash/omit";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatNumber,
} from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "../Modal";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";
import Field from "../Forms/Field";
import InlineCode from "../SyntaxHighlighting/InlineCode";
import Toggle from "../Forms/Toggle";
import RiskThresholds from "../Metrics/MetricForm/RiskThresholds";
import Tabs from "../Tabs/Tabs";
import Tab from "../Tabs/Tab";
import PremiumTooltip from "../Marketing/PremiumTooltip";
import { GBAddCircle, GBArrowLeft, GBCuped } from "../Icons";
import { getNewExperimentDatasourceDefaults } from "../Experiment/NewExperimentForm";
import ButtonSelectField from "../Forms/ButtonSelectField";
import { MetricWindowSettingsForm } from "../Metrics/MetricForm/MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "../Metrics/MetricForm/MetricCappingSettingsForm";
import { ConversionDelayHours } from "../Metrics/MetricForm/ConversionDelayHours";
import { OfficialBadge } from "../Metrics/MetricName";

export interface Props {
  close?: () => void;
  initialFactTable?: string;
  existing?: FactMetricInterface;
  showAdvancedSettings?: boolean;
  onSave?: () => void;
  goBack?: () => void;
  source: string;
}

function ColumnRefSelector({
  value,
  setValue,
  includeCountDistinct,
  includeColumn,
  datasource,
  disableFactTableSelector,
}: {
  setValue: (ref: ColumnRef) => void;
  value: ColumnRef;
  includeCountDistinct?: boolean;
  includeColumn?: boolean;
  datasource: string;
  disableFactTableSelector?: boolean;
}) {
  const { getFactTableById, factTables } = useDefinitions();

  let factTable = getFactTableById(value.factTableId);
  if (factTable?.datasource !== datasource) factTable = null;

  const [showFilters, setShowFilters] = useState(value.filters.length > 0);

  // If there's nothing for the user to configure
  if (
    !includeColumn &&
    disableFactTableSelector &&
    !factTable?.filters?.length
  ) {
    return null;
  }

  const columnOptions = (factTable?.columns || [])
    .filter(
      (col) =>
        !col.deleted &&
        col.column !== "timestamp" &&
        !factTable?.userIdTypes?.includes(col.column)
    )
    .filter((col) => col.datatype === "number")
    .map((col) => ({
      label: `SUM(\`${col.name}\`)`,
      value: col.column,
    }));

  return (
    <div className="appbox px-3 pt-3 bg-light">
      <div className="row align-items-center">
        {includeColumn && (
          <div className="col-auto">
            <SelectField
              label="SELECT"
              value={value.column}
              onChange={(column) => setValue({ ...value, column })}
              sort={false}
              options={[
                ...(includeCountDistinct
                  ? [
                      {
                        label: `COUNT( DISTINCT \`Experiment Users\` )`,
                        value: "$$distinctUsers",
                      },
                    ]
                  : []),
                {
                  label: "COUNT(*)",
                  value: "$$count",
                },
                ...columnOptions,
              ]}
              placeholder="Column..."
              formatOptionLabel={({ label }) => {
                return <InlineCode language="sql" code={label} />;
              }}
              required
            />
          </div>
        )}
        {includeColumn || !disableFactTableSelector ? (
          <div className="col-auto">
            <SelectField
              label={includeColumn ? "FROM" : "SELECT FROM"}
              disabled={disableFactTableSelector}
              value={value.factTableId}
              onChange={(factTableId) =>
                setValue({
                  factTableId,
                  column: value.column?.match(/^\$\$/)
                    ? value.column
                    : "$$count",
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
        ) : null}
        {factTable && factTable.filters.length > 0 ? (
          <div className="col-auto">
            {value.filters.length > 0 || showFilters ? (
              <MultiSelectField
                label="WHERE"
                value={value.filters}
                onChange={(filters) => setValue({ ...value, filters })}
                options={factTable.filters.map((f) => ({
                  label: f.name,
                  value: f.id,
                }))}
                placeholder="Add Filter..."
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
            ) : (
              <div className="form-group">
                <button
                  className="btn btn-link"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowFilters(true);
                  }}
                >
                  <GBAddCircle /> Add WHERE Clause
                </button>
              </div>
            )}
          </div>
        ) : null}
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
      windowSettings: existing?.windowSettings || {
        type: DEFAULT_FACT_METRIC_WINDOW,
        delayHours: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        windowUnit: "days",
        windowValue: 3,
      },
      winRisk: (existing?.winRisk || defaultWinRiskThreshold) * 100,
      loseRisk: (existing?.loseRisk || defaultLoseRiskThreshold) * 100,
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

  if (type === "ratio") {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>Not available for ratio metrics.</>
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
              form.setValue("metricType", type);

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
              {
                value: "ratio",
                label: "Ratio",
              },
            ]}
          />
          {type === "proportion" ? (
            <div>
              <p className="text-muted">
                (<strong>Metric Value</strong> = Percent of Experiment Users who
                exist in a Fact Table)
              </p>
              <ColumnRefSelector
                value={form.watch("numerator")}
                setValue={(numerator) => form.setValue("numerator", numerator)}
                datasource={selectedDataSource.id}
                disableFactTableSelector={!!initialFactTable}
              />
            </div>
          ) : type === "mean" ? (
            <div>
              <p className="text-muted">
                (<strong>Metric Value</strong> = Average of a numeric value
                among all Experiment Users)
              </p>
              <ColumnRefSelector
                value={form.watch("numerator")}
                setValue={(numerator) => form.setValue("numerator", numerator)}
                includeColumn={true}
                datasource={selectedDataSource.id}
                disableFactTableSelector={!!initialFactTable}
              />
            </div>
          ) : type === "ratio" ? (
            <>
              <p className="text-muted">
                (<strong>Metric Value</strong> = Numerator / Denominator){" "}
                <Tooltip body="Ratio metrics use the Delta Method to provide an accurate estimation of variance" />
              </p>
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
                <ConversionDelayHours form={form} />
                <MetricCappingSettingsForm
                  form={form}
                  datasourceType={selectedDataSource.type}
                  metricType={type}
                />
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
