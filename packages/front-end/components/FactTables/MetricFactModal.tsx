import { useForm } from "react-hook-form";
import clsx from "clsx";
import { FaTimes } from "react-icons/fa";
import { useState } from "react";
import { MetricInterface } from "back-end/types/metric";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
} from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatConversionRate,
} from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
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
import { GBCuped } from "../Icons";

export interface Props {
  close: () => void;
  onSave: () => void;
  initialFactTable?: string;
}

type FactRef = {
  factTableId: string;
  factId: string;
  filters: string[];
};
type Metric = Pick<
  MetricInterface,
  | "name"
  | "description"
  | "tags"
  | "inverse"
  | "capValue"
  | "conversionDelayHours"
  | "minPercentChange"
  | "maxPercentChange"
  | "minSampleSize"
  | "regressionAdjustmentDays"
  | "regressionAdjustmentEnabled"
  | "regressionAdjustmentOverride"
> & {
  capping: string;
  factSettings: {
    metricType: "ratio" | "average" | "proportion";
    numerator: FactRef;
    denominator: FactRef | null;
  };
  hasConversionWindow: boolean;
  conversionWindowValue: number;
  conversionWindowUnit: "weeks" | "days" | "hours";
  winRisk: number;
  loseRisk: number;
};

function FactSelector({
  value,
  setValue,
  includeCountDistinctFact,
  includeFact,
}: {
  setValue: (ref: FactRef) => void;
  value: FactRef;
  includeCountDistinctFact?: boolean;
  includeFact?: boolean;
}) {
  const { getFactTableById, factTables } = useDefinitions();

  const factTable = getFactTableById(value.factTableId);

  return (
    <div className="appbox px-3 pt-3 bg-light">
      <div className="row">
        <div className="col-auto">
          <SelectField
            label="Fact Table"
            value={value.factTableId}
            onChange={(factTableId) =>
              setValue({
                factTableId,
                factId: value.factId.match(/^\$\$/) ? value.factId : "$$count",
                filters: [],
              })
            }
            options={factTables.map((t) => ({
              label: t.name,
              value: t.id,
            }))}
            placeholder="Select..."
            required
          />
        </div>
        {factTable && (
          <div className="col-auto">
            <MultiSelectField
              label="Filter"
              value={value.filters}
              onChange={(filters) => setValue({ ...value, filters })}
              options={factTable.filters.map((f) => ({
                label: f.name,
                value: f.id,
              }))}
              placeholder="All Rows"
              closeMenuOnSelect={true}
            />
          </div>
        )}
        {factTable && includeFact && (
          <div className="col-auto">
            <SelectField
              label="Value"
              value={value.factId}
              onChange={(factId) => setValue({ ...value, factId })}
              sort={false}
              options={[
                ...(includeCountDistinctFact
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
                ...factTable.facts.map((f) => ({
                  label: `SUM(\`${f.name}\`)`,
                  value: f.id,
                })),
              ]}
              placeholder="Select..."
              formatOptionLabel={({ label }) => {
                return <InlineCode language="sql" code={label} />;
              }}
              required
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MetricFactModal({
  close,
  onSave,
  initialFactTable,
}: Props) {
  const { metricDefaults } = useOrganizationMetricDefaults();

  const settings = useOrgSettings();

  const { hasCommercialFeature } = useUser();

  const form = useForm<Metric>({
    defaultValues: {
      name: "",
      description: "",
      tags: [],
      factSettings: {
        metricType: "proportion",
        numerator: {
          factTableId: initialFactTable || "",
          factId: "$$count",
          filters: [],
        },
        denominator: null,
      },
      capping: "",
      capValue: 0,
      inverse: false,
      hasConversionWindow: false,
      conversionWindowValue: 3,
      conversionWindowUnit: "days",
      conversionDelayHours: 0,
      winRisk: defaultWinRiskThreshold * 100,
      loseRisk: defaultLoseRiskThreshold * 100,
      minPercentChange: metricDefaults.minPercentageChange * 100,
      maxPercentChange: metricDefaults.maxPercentageChange * 100,
      minSampleSize: metricDefaults.minimumSampleSize,
      regressionAdjustmentOverride: false,
      regressionAdjustmentEnabled: DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      regressionAdjustmentDays:
        settings.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
    },
  });

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const type = form.watch("factSettings.metricType");

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

  return (
    <Modal
      open={true}
      header="Create Metric"
      close={close}
      submit={form.handleSubmit(async (values) => {
        console.log(values);
        onSave();
        throw new Error("Not implemented yet");
      })}
      size="lg"
    >
      <Field
        label="Metric Name"
        {...form.register("name")}
        autoFocus
        required
      />
      <div className="mb-3">
        <label>
          Type of Metric{" "}
          <Tooltip
            body={
              <div>
                <div className="mb-2">
                  <strong>Proportion</strong> metrics calculate a simple
                  conversion rate - the proportion of users in your experiment
                  who are in a specific fact table.
                </div>
                <div className="mb-2">
                  <strong>Average</strong> metrics calculate the average value
                  of a numeric column in a fact table.
                </div>
                <div>
                  <strong>Ratio</strong> metrics allow you to calculate a
                  complex value by dividing two different numeric columns in
                  your fact tables.
                </div>
              </div>
            }
          />
        </label>
        <div>
          <div className="btn-group">
            <button
              type="button"
              className={clsx(
                "btn",
                type === "proportion"
                  ? "active btn-primary"
                  : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("factSettings.metricType", "proportion");
              }}
            >
              Proportion
            </button>
            <button
              type="button"
              className={clsx(
                "btn",
                type === "average"
                  ? "active btn-primary"
                  : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("factSettings.metricType", "average");
              }}
            >
              Average
            </button>
            <button
              type="button"
              className={clsx(
                "btn",
                type === "ratio" ? "active btn-primary" : "btn-outline-primary"
              )}
              onClick={(e) => {
                e.preventDefault();
                form.setValue("factSettings.metricType", "ratio");
              }}
            >
              Ratio
            </button>
          </div>
        </div>
      </div>
      {type === "proportion" ? (
        <div>
          <p>
            <strong>Metric Value</strong> = Percent of Experiment Users who
            exist in the selected Fact Table
          </p>
          <FactSelector
            value={form.watch("factSettings.numerator")}
            setValue={(numerator) =>
              form.setValue("factSettings.numerator", numerator)
            }
          />
        </div>
      ) : type === "average" ? (
        <div>
          <p>
            <strong>Metric Value</strong> = Average Value of all Experiment
            Users
          </p>
          <FactSelector
            value={form.watch("factSettings.numerator")}
            setValue={(numerator) =>
              form.setValue("factSettings.numerator", numerator)
            }
            includeFact={true}
          />
        </div>
      ) : type === "ratio" ? (
        <>
          <p>
            <strong>Metric Value</strong> = (Numerator Value) / (Denominator
            Value)
          </p>
          <div className="form-group">
            <label>Numerator</label>
            <FactSelector
              value={form.watch("factSettings.numerator")}
              setValue={(numerator) =>
                form.setValue("factSettings.numerator", numerator)
              }
              includeFact={true}
              includeCountDistinctFact={true}
            />
          </div>
          <div className="form-group">
            <label>Denominator</label>
            <FactSelector
              value={
                form.watch("factSettings.denominator") || {
                  factId: "$$count",
                  factTableId: initialFactTable || "",
                  filters: [],
                }
              }
              setValue={(denominator) =>
                form.setValue("factSettings.denominator", denominator)
              }
              includeFact={true}
              includeCountDistinctFact={true}
            />
          </div>
        </>
      ) : (
        <p>Select a metric type above</p>
      )}

      <div className="mb-3 mt-4">
        <div className="form-group mb-1">
          <Toggle
            value={form.watch("hasConversionWindow")}
            setValue={(value) => form.setValue("hasConversionWindow", value)}
            id="enableConversionWindow"
            label={"Add Conversion Window"}
          />
          <label htmlFor="enableConversionWindow">
            Enable Conversion Window{" "}
            <Tooltip body="Require conversions (as defined above) to happen within a specified amount of time from when the user first sees the experiment." />
          </label>
        </div>

        {form.watch("hasConversionWindow") && (
          <div className="appbox p-3 bg-light">
            <div className="row align-items-center">
              <div className="col-auto">Must happen within</div>
              <div className="col-auto">
                <Field
                  {...form.register("conversionWindowValue", {
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
              <div className="col-auto">
                <SelectField
                  value={form.watch("conversionWindowUnit")}
                  onChange={(value) => {
                    form.setValue(
                      "conversionWindowUnit",
                      value as "days" | "hours"
                    );
                  }}
                  sort={false}
                  options={[
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
              <div className="col-auto">of viewing experiment</div>
            </div>
          </div>
        )}
      </div>

      {!advancedOpen && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setAdvancedOpen(true);
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
            <SelectField
              label="Cap User Values?"
              value={form.watch("capping")}
              onChange={(v: string) => {
                form.setValue("capping", v);
              }}
              sort={false}
              options={[
                {
                  value: "",
                  label: "No",
                },
                {
                  value: "absolute",
                  label: "Absolute capping",
                },
                {
                  value: "percentile",
                  label: "Percentile capping",
                },
              ]}
              helpText="Capping (winsorization) can reduce variance by capping aggregated
              user values."
            />
            {form.watch("capping") ? (
              <div className="appbox bg-light px-3 pt-3">
                <Field
                  label="Capped Value"
                  type="number"
                  step="any"
                  min="0"
                  max={form.watch("capping") === "percentile" ? "1" : ""}
                  {...form.register("capValue", { valueAsNumber: true })}
                  helpText={
                    form.watch("capping") === "absolute"
                      ? `
              Absolute capping: if greater than zero, aggregated user values will be capped at this value.`
                      : `Percentile capping: if greater than zero, we use all metric data in the experiment to compute the percentiles of the user aggregated values. Then, we get the value at the percentile provided and cap all users at this value. Enter a number between 0 and 0.99999`
                  }
                />
              </div>
            ) : null}
            <div className="form-group">
              <label>Conversion Delay (hours)</label>
              <input
                type="number"
                step="any"
                className="form-control"
                placeholder={"0"}
                {...form.register("conversionDelayHours", {
                  valueAsNumber: true,
                })}
              />
              <small className="text-muted">
                Ignore all conversions within the first X hours of being put
                into an experiment.
              </small>
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
                          form.setValue("regressionAdjustmentEnabled", value);
                        }}
                        disabled={!hasRegressionAdjustmentFeature}
                      />
                      <small className="form-text text-muted">
                        (organization default:{" "}
                        {settings.regressionAdjustmentEnabled ? "On" : "Off"})
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
                  : formatConversionRate(
                      "count",
                      metricDefaults.minimumSampleSize
                    )}
                )
              </small>
            </div>
            <Field
              label="Max Percent Change"
              type="number"
              step="any"
              append="%"
              {...form.register("maxPercentChange", { valueAsNumber: true })}
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
              {...form.register("minPercentChange", { valueAsNumber: true })}
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
    </Modal>
  );
}
