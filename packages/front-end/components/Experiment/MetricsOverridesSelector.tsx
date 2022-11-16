import { useState } from "react";
import SelectField from "../Forms/SelectField";
import {
  ExperimentInterfaceStringDates,
  MetricOverride,
} from "back-end/types/experiment";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

export default function MetricsOverridesSelector({
  experiment,
  metricOverrides,
  onChange,
}: {
  experiment: ExperimentInterfaceStringDates;
  metricOverrides: MetricOverride[];
  onChange: (metricOverrides: MetricOverride[]) => void;
}) {
  const [selectedMetricId, setSelectedMetricId] = useState<string>("");
  const { metrics: metricDefinitions } = useDefinitions();
  const metrics = experiment.metrics;
  const unusedMetrics = metrics.filter(
    (m) => metricOverrides.findIndex((mo) => m === mo.id) < 0
  );

  return (
    <>
      {metricOverrides.map((mo, i) => {
        const metricDefinition = metricDefinitions.find(
          (md) => md.id === mo.id
        );
        return (
          <div className="appbox px-3 pt-3 bg-light" key={i}>
            <div style={{ float: "right" }}>
              <a
                href="#"
                className="text-danger"
                onClick={(e) => {
                  e.preventDefault();
                  const newMetricOverrides = structuredClone(metricOverrides);
                  newMetricOverrides.splice(i, 1);
                  onChange(newMetricOverrides);
                }}
              >
                remove
              </a>
            </div>

            <div>
              <label>
                <strong>{metricDefinition.name}</strong>
              </label>
              <table className="table table-borderless mb-0" width="100%">
                <tbody>
                  <tr>
                    <td className="pt-0">
                      <Field
                        label="Conversion Delay (hours)"
                        type="number"
                        containerClassName="mb-1"
                        defaultValue={mo.conversionDelayHours}
                        onChange={(e) => {
                          const newMetricOverrides = structuredClone(
                            metricOverrides
                          );
                          newMetricOverrides[i].conversionDelayHours = Math.max(
                            parseInt(e.target.value) || 0,
                            0
                          );
                          onChange(newMetricOverrides);
                        }}
                      />
                    </td>
                    <td className="pt-0">
                      <Field
                        label="Conversion Window (hours)"
                        type="number"
                        containerClassName="mb-1"
                        defaultValue={mo.conversionWindowHours}
                        onChange={(e) => {
                          const newMetricOverrides = structuredClone(
                            metricOverrides
                          );
                          newMetricOverrides[
                            i
                          ].conversionWindowHours = Math.max(
                            parseInt(e.target.value) || 0,
                            0
                          );
                          onChange(newMetricOverrides);
                        }}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
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
            />
          </div>
          <div className="col-auto">
            <button
              className="btn btn-outline-primary"
              disabled={!selectedMetricId}
              onClick={(e) => {
                e.preventDefault();
                const newMetricOverrides = [
                  ...structuredClone(metricOverrides),
                  {
                    id: selectedMetricId,
                    conversionDelayHours: 0,
                    conversionWindowHours: 0,
                  },
                ];
                setSelectedMetricId("");
                onChange(newMetricOverrides);
              }}
            >
              Add Metric Override
            </button>
          </div>
        </div>
      )}
    </>
  );
}
