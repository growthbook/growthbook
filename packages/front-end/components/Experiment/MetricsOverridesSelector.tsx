import React, { useEffect, useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { FaTimes } from "react-icons/fa";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "shared/constants";
import { isUndefined } from "lodash";
import {
  getConversionWindowHours,
  isBinomialMetric,
  isFactMetric,
  isRatioMetric,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Toggle from "@/components/Forms/Toggle";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import { capitalizeFirstLetter } from "@/services/utils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import { EditMetricsFormInterface } from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";

export default function MetricsOverridesSelector({
  experiment,
  form,
  disabled,
  setHasMetricOverrideRiskError,
}: {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<EditMetricsFormInterface>;
  disabled: boolean;
  setHasMetricOverrideRiskError: (boolean) => void;
}) {
  const [selectedMetricId, setSelectedMetricId] = useState<string>("");
  const {
    metrics: metricDefinitions,
    factMetrics: factMetricDefinitions,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();

  const allMetricDefinitions = useMemo(
    () => [...metricDefinitions, ...factMetricDefinitions],
    [metricDefinitions, factMetricDefinitions]
  );

  const metrics = new Set(
    form.watch("metrics").concat(form.watch("guardrails"))
  );
  const activationMetric = form.watch("activationMetric");
  if (activationMetric) {
    metrics.add(activationMetric);
  }

  const metricOverrides = useFieldArray({
    control: form.control,
    name: "metricOverrides",
  });

  const usedMetrics = new Set(form.watch("metricOverrides").map((m) => m.id));
  const unusedMetrics = [...metrics].filter((m) => !usedMetrics.has(m));

  useEffect(() => {
    let hasRiskError = false;
    !disabled &&
      metricOverrides.fields.map((v, i) => {
        const mo = form.watch(`metricOverrides.${i}`);
        const metricDefinition = allMetricDefinitions.find(
          (md) => md.id === mo.id
        );

        const loseRisk =
          isUndefined(mo.loseRisk) || isNaN(mo.loseRisk)
            ? metricDefinition?.loseRisk
            : mo.loseRisk / 100;
        const winRisk =
          isUndefined(mo.winRisk) || isNaN(mo.winRisk)
            ? metricDefinition?.winRisk
            : mo.winRisk / 100;
        if (
          !isUndefined(loseRisk) &&
          !isUndefined(winRisk) &&
          loseRisk < winRisk
        ) {
          hasRiskError = true;
        }
      });
    setHasMetricOverrideRiskError(hasRiskError);
  }, [
    disabled,
    allMetricDefinitions,
    metricOverrides,
    form,
    setHasMetricOverrideRiskError,
  ]);

  return (
    <div className="mb-3">
      {!disabled &&
        metricOverrides.fields.map((v, i) => {
          const mo = form.watch(`metricOverrides.${i}`);
          const metricDefinition = allMetricDefinitions.find(
            (md) => md.id === mo.id
          );

          const hasRegressionAdjustmentFeature = hasCommercialFeature(
            "regression-adjustment"
          );
          let regressionAdjustmentAvailableForMetric = true;
          let regressionAdjustmentAvailableForMetricReason = <></>;
          if (
            metricDefinition &&
            isFactMetric(metricDefinition) &&
            isRatioMetric(metricDefinition)
          ) {
            regressionAdjustmentAvailableForMetric = false;
            regressionAdjustmentAvailableForMetricReason = (
              <>Not available for ratio metrics.</>
            );
          }
          if (metricDefinition?.denominator) {
            const denominator = allMetricDefinitions.find(
              (m) => m.id === metricDefinition.denominator
            );
            if (denominator && !isBinomialMetric(denominator)) {
              regressionAdjustmentAvailableForMetric = false;
              regressionAdjustmentAvailableForMetricReason = (
                <>
                  Not available for metrics where the denominator is a{" "}
                  <em>binomial</em> type.
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

          const loseRisk =
            isUndefined(mo.loseRisk) || isNaN(mo.loseRisk)
              ? metricDefinition?.loseRisk
              : mo.loseRisk / 100;
          const winRisk =
            isUndefined(mo.winRisk) || isNaN(mo.winRisk)
              ? metricDefinition?.winRisk
              : mo.winRisk / 100;
          let riskError = "";
          if (
            !isUndefined(loseRisk) &&
            !isUndefined(winRisk) &&
            loseRisk < winRisk
          ) {
            riskError =
              "The acceptable risk percentage cannot be higher than the too risky percentage";
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
                  <strong className="text-body">
                    <MetricName id={metricDefinition?.id || ""} />
                  </strong>
                </label>

                <div className="row mt-1">
                  <div className="col mr-1">
                    <span className="uppercase-title">
                      Conversion/Lookback Window
                    </span>
                  </div>
                  <div className="col ml-1">
                    <span className="uppercase-title">Risk Thresholds</span>{" "}
                    <span className="small text-muted">(Bayesian only)</span>
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
                                  metricDefinition.windowSettings.type || "none"
                                )
                              : ""
                          } (default)`}
                          value={
                            form.watch(`metricOverrides.${i}.windowType`) ??
                            metricDefinition?.windowSettings?.type ??
                            ""
                          }
                          onChange={(value) => {
                            form.setValue(
                              `metricOverrides.${i}.windowType`,
                              value as "conversion" | "lookback" | ""
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
                            {
                              label: "Lookback",
                              value: "lookback",
                            },
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
                      </div>
                      {(form.watch(`metricOverrides.${i}.windowType`) ??
                        metricDefinition?.windowSettings?.type) ===
                      "conversion" ? (
                        <div className="row m-1 mr-1 px-1">
                          <div className="col">
                            <Field
                              label="Metric Delay (hours)"
                              placeholder="default"
                              helpText={
                                <div className="text-right">
                                  default:{" "}
                                  {metricDefinition?.windowSettings
                                    .delayHours ?? 0}
                                </div>
                              }
                              labelClassName="small mb-1"
                              type="number"
                              containerClassName="mb-0 metric-override"
                              step="any"
                              {...form.register(
                                `metricOverrides.${i}.delayHours`,
                                { valueAsNumber: true }
                              )}
                            />
                          </div>
                          <div className="col">
                            <Field
                              label="Conversion Window (hours)"
                              placeholder="default"
                              helpText={
                                <div className="text-right">
                                  default:{" "}
                                  {metricDefinition?.windowSettings?.type !==
                                  "conversion"
                                    ? "No conversion window "
                                    : metricDefinition?.windowSettings
                                    ? getConversionWindowHours(
                                        metricDefinition.windowSettings
                                      )
                                    : null}{" "}
                                </div>
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
                                `metricOverrides.${i}.windowHours`,
                                { valueAsNumber: true }
                              )}
                            />
                          </div>
                        </div>
                      ) : null}
                      {(form.watch(`metricOverrides.${i}.windowType`) ??
                        metricDefinition?.windowSettings?.type) ===
                      "lookback" ? (
                        <div className="row m-1 mr-1 px-1">
                          <div className="col">
                            <Field
                              label="Metric Delay (hours)"
                              placeholder="default"
                              helpText={
                                <div className="text-right">
                                  default:{" "}
                                  {["conversion", "lookback"].includes(
                                    metricDefinition?.windowSettings?.type ?? ""
                                  )
                                    ? "No delay"
                                    : metricDefinition?.windowSettings
                                        .delayHours}
                                </div>
                              }
                              labelClassName="small mb-1"
                              type="number"
                              containerClassName="mb-0 metric-override"
                              step="any"
                              {...form.register(
                                `metricOverrides.${i}.delayHours`,
                                { valueAsNumber: true }
                              )}
                            />
                          </div>
                          <div className="col">
                            <Field
                              label="Lookback Window (hours)"
                              placeholder="default"
                              helpText={
                                <div className="text-right">
                                  default:{" "}
                                  {metricDefinition?.windowSettings?.type !==
                                  "lookback"
                                    ? "No lookback window "
                                    : metricDefinition?.windowSettings
                                    ? getConversionWindowHours(
                                        metricDefinition.windowSettings
                                      )
                                    : null}{" "}
                                </div>
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
                                `metricOverrides.${i}.windowHours`,
                                { valueAsNumber: true }
                              )}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="col border m-1 ml-2 px-2 py-1 rounded">
                    <div className="row">
                      <div className="col">
                        <Field
                          label="Acceptable risk under..."
                          placeholder="default"
                          helpText={
                            <div className="text-right">
                              default: {(metricDefinition?.winRisk ?? 0) * 100}%
                            </div>
                          }
                          append="%"
                          labelClassName="small mb-1"
                          type="number"
                          containerClassName="mb-0 metric-override"
                          min={0}
                          step="any"
                          {...form.register(`metricOverrides.${i}.winRisk`, {
                            valueAsNumber: true,
                          })}
                        />
                      </div>
                      <div className="col">
                        <Field
                          label="Too much risk over..."
                          placeholder="default"
                          helpText={
                            <div className="text-right">
                              default: {(metricDefinition?.loseRisk ?? 0) * 100}
                              %
                            </div>
                          }
                          append="%"
                          labelClassName="small mb-1"
                          type="number"
                          containerClassName="mb-0 metric-override"
                          min={0}
                          step="any"
                          {...form.register(`metricOverrides.${i}.loseRisk`, {
                            valueAsNumber: true,
                          })}
                        />
                      </div>
                    </div>
                    {riskError && (
                      <div className="row">
                        <div className="col text-danger small">{riskError}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="row mt-1">
                  <div className="col">
                    <PremiumTooltip commercialFeature="regression-adjustment">
                      <span className="uppercase-title">
                        <GBCuped size={14} /> Regression Adjustment (CUPED)
                      </span>
                    </PremiumTooltip>{" "}
                    <span className="small text-muted">(Frequentist only)</span>
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
                              `metricOverrides.${i}.regressionAdjustmentOverride`
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
                              `metricOverrides.${i}.regressionAdjustmentOverride`
                            )
                              ? "block"
                              : "none",
                          }}
                        >
                          <div className="d-flex my-2 border-bottom"></div>
                          <div className="form-group mt-1 mb-2 mr-2 form-inline">
                            <label
                              className="small mr-1"
                              htmlFor={`toggle-regressionAdjustmentEnabled_${i}`}
                            >
                              Apply regression adjustment for this metric
                            </label>
                            <Toggle
                              id={`toggle-regressionAdjustmentEnabled_${i}`}
                              value={
                                !!form.watch(
                                  `metricOverrides.${i}.regressionAdjustmentEnabled`
                                )
                              }
                              setValue={(value) => {
                                form.setValue(
                                  `metricOverrides.${i}.regressionAdjustmentEnabled`,
                                  value
                                );
                              }}
                              disabled={!hasRegressionAdjustmentFeature}
                            />
                            <div className="small">
                              <small className="form-text text-muted">
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
                          </div>
                          <div
                            className="form-group mt-1 mb-1 mr-2"
                            style={{
                              opacity: form.watch(
                                `metricOverrides.${i}.regressionAdjustmentEnabled`
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
                                `metricOverrides.${i}.regressionAdjustmentDays`,
                                {
                                  valueAsNumber: true,
                                  validate: (v) => {
                                    return !((v ?? 0) <= 0 || (v ?? 0) > 100);
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
                metricOverrides.append({
                  id: selectedMetricId,
                });
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
