import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { FaTimes } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Toggle from "@/components/Forms/Toggle";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "@/constants/stats";
import SelectField from "../Forms/SelectField";
import Field from "../Forms/Field";
import { EditMetricsFormInterface } from "./EditMetricsForm";

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
  const { metrics: metricDefinitions } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();

  const metrics = new Set(
    form.watch("metrics").concat(form.watch("guardrails"))
  );
  if (experiment.activationMetric) {
    metrics.add(experiment.activationMetric);
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
        const metricDefinition = metricDefinitions.find(
          (md) => md.id === mo.id
        );
        const loseRisk = isNaN(mo.loseRisk)
          ? metricDefinition.loseRisk
          : mo.loseRisk / 100;
        const winRisk = isNaN(mo.winRisk)
          ? metricDefinition.winRisk
          : mo.winRisk / 100;
        if (loseRisk < winRisk) {
          hasRiskError = true;
        }
      });
    setHasMetricOverrideRiskError(hasRiskError);
  }, [
    disabled,
    metricDefinitions,
    metricOverrides,
    form,
    setHasMetricOverrideRiskError,
  ]);

  return (
    <div className="mb-3">
      {!disabled &&
        metricOverrides.fields.map((v, i) => {
          const mo = form.watch(`metricOverrides.${i}`);
          const metricDefinition = metricDefinitions.find(
            (md) => md.id === mo.id
          );

          const hasRegressionAdjustmentFeature = hasCommercialFeature(
            "regression-adjustment"
          );
          let regressionAdjustmentAvailableForMetric = true;
          let regressionAdjustmentAvailableForMetricReason = <></>;
          if (metricDefinition.denominator) {
            const denominator = metricDefinitions.find(
              (m) => m.id === metricDefinition.denominator
            );
            if (denominator?.type === "count") {
              regressionAdjustmentAvailableForMetric = false;
              regressionAdjustmentAvailableForMetricReason = (
                <>
                  Not available for ratio metrics with <em>count</em>{" "}
                  denominators.
                </>
              );
            }
          }
          if (metricDefinition.aggregation) {
            regressionAdjustmentAvailableForMetric = false;
            regressionAdjustmentAvailableForMetricReason = (
              <>Not available for metrics with custom aggregations.</>
            );
          }

          const loseRisk = isNaN(mo.loseRisk)
            ? metricDefinition.loseRisk
            : mo.loseRisk / 100;
          const winRisk = isNaN(mo.winRisk)
            ? metricDefinition.winRisk
            : mo.winRisk / 100;
          const riskError =
            loseRisk < winRisk
              ? "The acceptable risk percentage cannot be higher than the too risky percentage"
              : "";

          const regressionAdjustmentDaysHighlightColor =
            mo.regressionAdjustmentDays > 28 || mo.regressionAdjustmentDays < 7
              ? "#e27202"
              : "";
          const regressionAdjustmentDaysWarningMsg =
            mo.regressionAdjustmentDays > 28
              ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
              : mo.regressionAdjustmentDays < 7
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
                  <strong className="text-purple">
                    {metricDefinition.name}
                  </strong>
                </label>

                <div className="row mt-1">
                  <div className="col mr-1">
                    <span className="uppercase-title">Conversion Window</span>
                  </div>
                  <div className="col ml-1">
                    <span className="uppercase-title">Risk Thresholds</span>{" "}
                    <span className="small text-muted">(Bayesian only)</span>
                  </div>
                </div>
                <div className="row">
                  <div className="col border m-1 mr-2 px-2 py-1 rounded">
                    <div className="row">
                      <div className="col">
                        <Field
                          label="Conversion Delay (hours)"
                          placeholder="default"
                          helpText={
                            <div className="text-right">
                              default: {metricDefinition.conversionDelayHours}
                            </div>
                          }
                          labelClassName="small mb-1"
                          type="number"
                          containerClassName="mb-0 metric-override"
                          step="any"
                          {...form.register(
                            `metricOverrides.${i}.conversionDelayHours`,
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
                              default: {metricDefinition.conversionWindowHours}{" "}
                            </div>
                          }
                          labelClassName="small mb-1"
                          type="number"
                          containerClassName="mb-0 metric-override"
                          min={0}
                          step="any"
                          {...form.register(
                            `metricOverrides.${i}.conversionWindowHours`,
                            { valueAsNumber: true }
                          )}
                        />
                      </div>
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
                              default: {(metricDefinition.winRisk || 0) * 100}%
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
                              default: {(metricDefinition.loseRisk || 0) * 100}%
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
                                {metricDefinition.regressionAdjustmentOverride ? (
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
                                    {metricDefinition.regressionAdjustmentOverride ? (
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
                </div>
              </div>
            </div>
          );
        })}
      {unusedMetrics.length > 0 && (
        <div className="row">
          <div className="col">
            <SelectField
              value={
                metricDefinitions.find((md) => md.id === selectedMetricId)
                  ?.name || ""
              }
              onChange={(m) => setSelectedMetricId(m)}
              initialOption="Choose Metric..."
              options={unusedMetrics.map((m) => {
                const metric = metricDefinitions.find((md) => md.id === m);
                return {
                  label: metric.name,
                  value: metric.id,
                };
              })}
              disabled={disabled}
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
