import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { useDefinitions } from "@/services/DefinitionsContext";
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
                  <strong>{metricDefinition.name}</strong>
                </label>
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
                      containerClassName="mb-1 metric-override"
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
                      containerClassName="mb-1 metric-override"
                      min={0}
                      step="any"
                      {...form.register(
                        `metricOverrides.${i}.conversionWindowHours`,
                        { valueAsNumber: true }
                      )}
                    />
                  </div>
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
                      containerClassName="mb-1 metric-override"
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
                      containerClassName="mb-1 metric-override"
                      min={0}
                      step="any"
                      {...form.register(`metricOverrides.${i}.loseRisk`, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                </div>
                {riskError && (
                  <div className="row mb-1">
                    <div className="col-6"></div>
                    <div className="col-6 text-danger small">{riskError}</div>
                  </div>
                )}
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
