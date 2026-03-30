import React, { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { FaTimes } from "react-icons/fa";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { isUndefined } from "lodash";
import {
  expandMetricGroups,
  getMetricWindowHours,
  getDelayWindowHours,
  isBinomialMetric,
  isFactMetric,
  isRetentionMetric,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Switch from "@/ui/Switch";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import { capitalizeFirstLetter } from "@/services/utils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import { getDefaultMetricOverridesFormValue } from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";

const defaultFieldMap = {
  goalMetrics: "goalMetrics",
  guardrailMetrics: "guardrailMetrics",
  secondaryMetrics: "secondaryMetrics",
  activationMetric: "activationMetric",
  metricOverrides: "metricOverrides",
};

export default function MetricsOverridesSelector({
  experiment,
  form,
  disabled,
  fieldMap = defaultFieldMap,
}: {
  experiment: ExperimentInterfaceStringDates;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  disabled: boolean;
  fieldMap?: typeof defaultFieldMap;
}) {
  const [selectedMetricId, setSelectedMetricId] = useState<string>("");
  const {
    metrics: metricDefinitions,
    factMetrics: factMetricDefinitions,
    metricGroups,
    getExperimentMetricById,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();

  const allMetricDefinitions = useMemo(
    () => [...metricDefinitions, ...factMetricDefinitions],
    [metricDefinitions, factMetricDefinitions],
  );

  const unexpandedMetrics = new Set<string>(
    form
      .watch(fieldMap["goalMetrics"])
      .concat(form.watch(fieldMap["guardrailMetrics"]))
      .concat(form.watch(fieldMap["secondaryMetrics"])),
  );

  // expand metric groups
  const activationMetric = form.watch(fieldMap["activationMetric"]);
  if (activationMetric) {
    unexpandedMetrics.add(activationMetric);
  }

  const expandedMetrics = expandMetricGroups(
    Array.from(unexpandedMetrics),
    metricGroups,
  );

  const metricOverrides = useFieldArray({
    control: form.control,
    name: fieldMap["metricOverrides"],
  });

  const usedMetrics: Set<string> = new Set(
    form.watch(fieldMap["metricOverrides"]).map((m) => m.id),
  );
  const unusedMetrics: string[] = [...expandedMetrics].filter(
    (m) => !usedMetrics.has(m),
  );

  return (
    <div className="mb-3">
      {!disabled &&
        metricOverrides.fields.map((v, i) => {
          const mo = form.watch(`${fieldMap["metricOverrides"]}.${i}`);
          const metricDefinition = allMetricDefinitions.find(
            (md) => md.id === mo.id,
          );

          const defaultPriorSource = metricDefinition?.priorSettings.override
            ? "metric"
            : "organization";
          const defaultPriorSettings = metricDefinition?.priorSettings.override
            ? metricDefinition.priorSettings
            : (settings.metricDefaults?.priorSettings ?? {
                override: false,
                proper: false,
                mean: 0,
                stddev: DEFAULT_PROPER_PRIOR_STDDEV,
              });

          const hasRegressionAdjustmentFeature = hasCommercialFeature(
            "regression-adjustment",
          );
          let regressionAdjustmentAvailableForMetric = true;
          let regressionAdjustmentAvailableForMetricReason = <></>;
          if (metricDefinition?.denominator) {
            const denominator = allMetricDefinitions.find(
              (m) => m.id === metricDefinition.denominator,
            );
            if (
              denominator &&
              !isFactMetric(denominator) &&
              !isBinomialMetric(denominator)
            ) {
              regressionAdjustmentAvailableForMetric = false;
              regressionAdjustmentAvailableForMetricReason = (
                <>
                  Not available for metrics where the denominator is a{" "}
                  <em>{denominator.type}</em> type.
                </>
              );
            }
          }
          if (
            metricDefinition &&
            !isFactMetric(metricDefinition) &&
            metricDefinition?.aggregation
          ) {
            regressionAdjustmentAvailableForMetric = false;
            regressionAdjustmentAvailableForMetricReason = (
              <>Not available for metrics with custom aggregations.</>
            );
          }

          const regressionAdjustmentDaysHighlightColor =
            !isUndefined(mo.regressionAdjustmentDays) &&
            (mo.regressionAdjustmentDays > 28 ||
              mo.regressionAdjustmentDays < 7)
              ? "#e27202"
              : "";
          const regressionAdjustmentDaysWarningMsg =
            !isUndefined(mo.regressionAdjustmentDays) &&
            mo.regressionAdjustmentDays > 28
              ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
              : !isUndefined(mo.regressionAdjustmentDays) &&
                  mo.regressionAdjustmentDays < 7
                ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
                : "";

          return (
            <div className="appbox px-3 pt-1 bg-light" key={i}>
              <div style={{ float: "right" }}>
                <a
                  href="#"
                  className="text-danger"
                  onClick={(e) => {
                    e.preventDefault();
                    metricOverrides.remove(i);
                  }}
                >
                  remove
                </a>
              </div>

              <div>
                <label className="mb-1">
                  <strong>
                    <MetricName id={metricDefinition?.id || ""} />
                  </strong>
                </label>

                <div className="row mt-1">
                  <div className="col mr-1">
                    <span className="uppercase-title">
                      Conversion/Lookback Window
                    </span>
                  </div>
                </div>
                <div className="row">
                  <div className="col border m-1 mr-2 px-2 py-1 rounded">
                    <div className="row py-1">
                      <div className="col">
                        <SelectField
                          placeholder={`${
                            metricDefinition?.windowSettings?.type !== undefined
                              ? capitalizeFirstLetter(
                                  metricDefinition.windowSettings.type ||
                                    "none",
                                )
                              : ""
                          } (default)`}
                          value={
                            form.watch(
                              `${fieldMap["metricOverrides"]}.${i}.windowType`,
                            ) ??
                            metricDefinition?.windowSettings?.type ??
                            ""
                          }
                          onChange={(value) => {
                            form.setValue(
                              `${fieldMap["metricOverrides"]}.${i}.windowType`,
                              value as "conversion" | "lookback" | "",
                            );
                          }}
                          sort={false}
                          options={[
                            {
                              label: "None",
                              value: "",
                            },
                            {
                              label: "Conversion",
                              value: "conversion",
                            },
                            ...(metricDefinition &&
                            !isRetentionMetric(metricDefinition)
                              ? [
                                  {
                                    label: "Lookback",
                                    value: "lookback",
                                  },
                                ]
                              : []),
                          ].map((v) => {
                            if (
                              v.value === metricDefinition?.windowSettings?.type
                            ) {
                              return {
                                ...v,
                                label: `${v.label} (default)`,
                              };
                            }
                            return v;
                          })}
                        />
                        {(form.watch(
                          `${fieldMap["metricOverrides"]}.${i}.windowType`,
                        ) ?? metricDefinition?.windowSettings?.type) ===
                          "conversion" ||
                        (metricDefinition &&
                          isRetentionMetric(metricDefinition)) ? (
                          <div className="row mt-2">
                            <div className="col">
                              <Field
                                label={
                                  metricDefinition &&
                                  isRetentionMetric(metricDefinition)
                                    ? "Retention Starts After (hours)"
                                    : "Metric Delay (hours)"
                                }
                                placeholder="default"
                                helpText={
                                  <>
                                    default:{" "}
                                    {metricDefinition?.windowSettings
                                      ? getDelayWindowHours(
                                          metricDefinition.windowSettings,
                                        )
                                      : 0}
                                  </>
                                }
                                labelClassName="small mb-1"
                                type="number"
                                containerClassName="mb-0 metric-override"
                                step="any"
                                {...form.register(
                                  `${fieldMap["metricOverrides"]}.${i}.delayHours`,
                                  { valueAsNumber: true },
                                )}
                              />
                            </div>
                            <div className="col">
                              <Field
                                label="Conversion Window (hours)"
                                placeholder="default"
                                disabled={
                                  (form.watch(
                                    `${fieldMap["metricOverrides"]}.${i}.windowType`,
                                  ) ??
                                    metricDefinition?.windowSettings?.type) !==
                                  "conversion"
                                }
                                helpText={
                                  <>
                                    default:{" "}
                                    {metricDefinition?.windowSettings?.type !==
                                    "conversion"
                                      ? "No conversion window "
                                      : metricDefinition?.windowSettings
                                        ? getMetricWindowHours(
                                            metricDefinition.windowSettings,
                                          )
                                        : null}{" "}
                                  </>
                                }
                                labelClassName="small mb-1"
                                type="number"
                                containerClassName="mb-0 metric-override"
                                required={
                                  metricDefinition?.windowSettings?.type !==
                                  "conversion"
                                }
                                min={
                                  metricDefinition &&
                                  isFactMetric(metricDefinition)
                                    ? 0
                                    : 0.125
                                }
                                step="any"
                                {...form.register(
                                  `${fieldMap["metricOverrides"]}.${i}.windowHours`,
                                  { valueAsNumber: true },
                                )}
                              />
                            </div>
                          </div>
                        ) : null}
                        {(form.watch(
                          `${fieldMap["metricOverrides"]}.${i}.windowType`,
                        ) ?? metricDefinition?.windowSettings?.type) ===
                        "lookback" ? (
                          <div className="row mt-2">
                            <div className="col">
                              <Field
                                label={
                                  metricDefinition &&
                                  isRetentionMetric(metricDefinition)
                                    ? "Retention Window (hours)"
                                    : "Metric Delay (hours)"
                                }
                                placeholder="default"
                                helpText={
                                  <>
                                    default:{" "}
                                    {metricDefinition?.windowSettings
                                      ? getDelayWindowHours(
                                          metricDefinition.windowSettings,
                                        )
                                      : 0}
                                  </>
                                }
                                labelClassName="small mb-1"
                                type="number"
                                containerClassName="mb-0 metric-override"
                                step="any"
                                {...form.register(
                                  `${fieldMap["metricOverrides"]}.${i}.delayHours`,
                                  { valueAsNumber: true },
                                )}
                              />
                            </div>
                            <div className="col">
                              <Field
                                label="Lookback Window (hours)"
                                placeholder="default"
                                helpText={
                                  <>
                                    default:{" "}
                                    {metricDefinition?.windowSettings?.type !==
                                    "lookback"
                                      ? "No lookback window "
                                      : metricDefinition?.windowSettings
                                        ? getMetricWindowHours(
                                            metricDefinition.windowSettings,
                                          )
                                        : null}{" "}
                                  </>
                                }
                                labelClassName="small mb-1"
                                type="number"
                                containerClassName="mb-0 metric-override"
                                min={
                                  metricDefinition &&
                                  isFactMetric(metricDefinition)
                                    ? 0
                                    : 0.125
                                }
                                required={
                                  metricDefinition?.windowSettings?.type !==
                                  "lookback"
                                }
                                step="any"
                                {...form.register(
                                  `${fieldMap["metricOverrides"]}.${i}.windowHours`,
                                  { valueAsNumber: true },
                                )}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="row mt-1">
                  <div className="col">
                    <span className="uppercase-title">Bayesian Priors</span>{" "}
                    <span className="small text-muted">(Bayesian only)</span>
                  </div>
                </div>

                <div className="row">
                  <div className="col border mx-1 mt-1 mb-2 px-2 py-1 rounded">
                    <div className="form-inline my-1">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        {...form.register(
                          `${fieldMap["metricOverrides"]}.${i}.properPriorOverride`,
                        )}
                        id={`toggle-priorOverride_${i}`}
                        disabled={!hasRegressionAdjustmentFeature}
                      />
                      <label
                        className="small mr-1 cursor-pointer"
                        htmlFor={`toggle-priorOverride_${i}`}
                      >
                        Override metric-level settings
                      </label>
                    </div>
                    <div
                      style={{
                        display: form.watch(
                          `${fieldMap["metricOverrides"]}.${i}.properPriorOverride`,
                        )
                          ? "block"
                          : "none",
                      }}
                    >
                      <div className="d-flex my-2 border-bottom"></div>
                      <Flex direction="column" mb="2">
                        <Switch
                          id={`toggle-properPrior_${i}`}
                          size="1"
                          label="Use proper prior for this metric"
                          value={
                            !!form.watch(
                              `${fieldMap["metricOverrides"]}.${i}.properPriorEnabled`,
                            )
                          }
                          onChange={(v) =>
                            form.setValue(
                              `${fieldMap["metricOverrides"]}.${i}.properPriorEnabled`,
                              v,
                            )
                          }
                        />
                        <div className="small">
                          <small className="form-text text-muted">
                            <>
                              {` (${defaultPriorSource} default: `}
                              {defaultPriorSettings.proper ? "On" : "Off"}
                              {")"}
                            </>
                          </small>
                        </div>
                      </Flex>
                      {(defaultPriorSettings.proper &&
                        !form.watch(
                          `${fieldMap["metricOverrides"]}.${i}.properPriorOverride`,
                        )) ||
                      !!form.watch(
                        `${fieldMap["metricOverrides"]}.${i}.properPriorEnabled`,
                      ) ? (
                        <>
                          <div className="row">
                            <div className="col">
                              <Field
                                label="Prior Mean"
                                type="number"
                                step="any"
                                placeholder="default"
                                containerClassName="small mb-0 mt-0"
                                helpText={
                                  <>{`${defaultPriorSource} default: ${defaultPriorSettings.mean}`}</>
                                }
                                {...form.register(
                                  `${fieldMap["metricOverrides"]}.${i}.properPriorMean`,
                                  {
                                    valueAsNumber: true,
                                  },
                                )}
                              />
                            </div>
                            <div className="col">
                              <Field
                                label="Prior Standard Deviation"
                                type="number"
                                step="any"
                                placeholder="default"
                                containerClassName="small mb-0 mt-0"
                                helpText={
                                  <>{`${defaultPriorSource} default: ${defaultPriorSettings.stddev}`}</>
                                }
                                {...form.register(
                                  `${fieldMap["metricOverrides"]}.${i}.properPriorStdDev`,
                                  {
                                    valueAsNumber: true,
                                    validate: (v) => {
                                      return !((v ?? 0) <= 0);
                                    },
                                  },
                                )}
                              />
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="row mt-1">
                  <div className="col">
                    <PremiumTooltip commercialFeature="regression-adjustment">
                      <span className="uppercase-title">
                        <GBCuped size={14} /> Regression Adjustment (CUPED)
                      </span>
                    </PremiumTooltip>{" "}
                  </div>
                </div>

                <div className="row">
                  <div className="col border mx-1 mt-1 mb-2 px-2 py-1 rounded">
                    {regressionAdjustmentAvailableForMetric ? (
                      <>
                        <div className="form-inline my-1">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            {...form.register(
                              `${fieldMap["metricOverrides"]}.${i}.regressionAdjustmentOverride`,
                            )}
                            id={`toggle-regressionAdjustmentOverride_${i}`}
                            disabled={!hasRegressionAdjustmentFeature}
                          />
                          <label
                            className="small mr-1 cursor-pointer"
                            htmlFor={`toggle-regressionAdjustmentOverride_${i}`}
                          >
                            Override metric-level settings
                          </label>
                        </div>
                        <div
                          style={{
                            display: form.watch(
                              `${fieldMap["metricOverrides"]}.${i}.regressionAdjustmentOverride`,
                            )
                              ? "block"
                              : "none",
                          }}
                        >
                          <div className="d-flex my-2 border-bottom"></div>
                          <Flex direction="column" mb="2">
                            <Switch
                              id={`toggle-regressionAdjustmentEnabled_${i}`}
                              size="1"
                              label="Apply regression adjustment for this metric"
                              value={
                                !!form.watch(
                                  `${fieldMap["metricOverrides"]}.${i}.regressionAdjustmentEnabled`,
                                )
                              }
                              onChange={(value) => {
                                form.setValue(
                                  `${fieldMap["metricOverrides"]}.${i}.regressionAdjustmentEnabled`,
                                  value,
                                );
                              }}
                              disabled={!hasRegressionAdjustmentFeature}
                            />
                            <div className="small">
                              <small className="text-muted">
                                {metricDefinition?.regressionAdjustmentOverride ? (
                                  <>
                                    (metric default:{" "}
                                    {metricDefinition.regressionAdjustmentEnabled
                                      ? "On"
                                      : "Off"}
                                    )
                                  </>
                                ) : (
                                  <>
                                    (organization default:{" "}
                                    {settings.regressionAdjustmentEnabled
                                      ? "On"
                                      : "Off"}
                                    )
                                  </>
                                )}
                              </small>
                            </div>
                          </Flex>
                          <div
                            className="form-group mt-1 mb-1 mr-2"
                            style={{
                              opacity: form.watch(
                                `${fieldMap["metricOverrides"]}.${i}.regressionAdjustmentEnabled`,
                              )
                                ? "1"
                                : "0.5",
                            }}
                          >
                            <Field
                              label="Pre-exposure lookback period (days)"
                              type="number"
                              style={{
                                borderColor:
                                  regressionAdjustmentDaysHighlightColor,
                                backgroundColor:
                                  regressionAdjustmentDaysHighlightColor
                                    ? regressionAdjustmentDaysHighlightColor +
                                      "15"
                                    : "",
                              }}
                              className="ml-2"
                              containerClassName="mb-0 small form-inline"
                              inputGroupClassName="d-inline-flex w-150px"
                              append="days"
                              min="0"
                              max="100"
                              disabled={!hasRegressionAdjustmentFeature}
                              helpText={
                                <>
                                  <span className="ml-2">
                                    {metricDefinition?.regressionAdjustmentOverride ? (
                                      <>
                                        (metric default:{" "}
                                        {
                                          metricDefinition.regressionAdjustmentDays
                                        }
                                        )
                                      </>
                                    ) : (
                                      <>
                                        (organization default:{" "}
                                        {settings.regressionAdjustmentDays ??
                                          DEFAULT_REGRESSION_ADJUSTMENT_DAYS}
                                        )
                                      </>
                                    )}
                                  </span>
                                </>
                              }
                              {...form.register(
                                `${fieldMap["metricOverrides"]}.${i}.regressionAdjustmentDays`,
                                {
                                  valueAsNumber: true,
                                  validate: (v) => {
                                    return !((v ?? 0) <= 0 || (v ?? 0) > 100);
                                  },
                                },
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
                </div>
              </div>
            </div>
          );
        })}
      {unusedMetrics.length > 0 && (
        <div className="row">
          <div className="col">
            <MetricSelector
              datasource={experiment.datasource}
              availableIds={unusedMetrics}
              project={experiment.project}
              includeFacts={true}
              value={selectedMetricId}
              onChange={(m) => setSelectedMetricId(m)}
              initialOption="Choose Metric..."
              disabled={disabled}
              onPaste={(e) => {
                try {
                  const clipboard = e.clipboardData;
                  const data = JSON.parse(clipboard.getData("Text"));
                  if (data.every((d) => d.startsWith("met_"))) {
                    e.preventDefault();
                    e.stopPropagation();
                    data.forEach((d) => {
                      metricOverrides.append({
                        id: d,
                      });
                    });
                  }
                } catch (e) {
                  // fail silently
                }
              }}
            />
          </div>
          <div className="col-auto">
            <button
              className="btn btn-outline-primary"
              disabled={disabled || !selectedMetricId}
              onClick={(e) => {
                e.preventDefault();
                const metricOverride = getDefaultMetricOverridesFormValue(
                  [{ id: selectedMetricId }],
                  getExperimentMetricById,
                  settings,
                )?.[0];
                if (metricOverride) {
                  metricOverrides.append(metricOverride);
                }
                setSelectedMetricId("");
              }}
            >
              Add Metric Override
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
