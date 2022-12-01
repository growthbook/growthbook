import { useState } from "react";
import SelectField from "../Forms/SelectField";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { EditMetricsFormInterface } from "./EditMetricsForm";
import { getDefaultConversionWindowHours } from "../../services/env";

export default function MetricsOverridesSelector({
  experiment,
  form,
  disabled,
}: {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<EditMetricsFormInterface>;
  disabled: boolean;
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

  return (
    <div className="mb-3">
      {!disabled &&
        metricOverrides.fields.map((v, i) => {
          const mo = form.watch(`metricOverrides.${i}`);
          const metricDefinition = metricDefinitions.find(
            (md) => md.id === mo.id
          );
          return (
            <div className="appbox px-3 bg-light" key={i}>
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
                <label>
                  <strong>{metricDefinition.name}</strong>
                </label>
                <div className="row mb-2">
                  <div className="col">
                    <Field
                      label="Conversion Delay (hours)"
                      type="number"
                      containerClassName="mb-1"
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
                      type="number"
                      containerClassName="mb-1"
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
                const metricDefinition = metricDefinitions.find(
                  (md) => md.id === selectedMetricId
                );
                metricOverrides.append({
                  id: selectedMetricId,
                  conversionDelayHours:
                    metricDefinition?.conversionDelayHours || 0,
                  conversionWindowHours:
                    metricDefinition?.conversionWindowHours ||
                    getDefaultConversionWindowHours(),
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
