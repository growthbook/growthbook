import MetricsSelector, { MetricsSelectorTooltip } from "./MetricsSelector";

export interface Props {
  datasource?: string;
  exposureQueryId?: string;
  project?: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  setGoalMetrics: (goalMetrics: string[]) => void;
  setSecondaryMetrics: (secondaryMetrics: string[]) => void;
  setGuardrailMetrics: (guardrailMetrics: string[]) => void;
  autoFocus?: boolean;
}

export default function ExperimentMetricsSelector({
  datasource,
  exposureQueryId,
  project,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  setGoalMetrics,
  setSecondaryMetrics,
  setGuardrailMetrics,
  autoFocus = false,
}: Props) {
  return (
    <>
      <div className="form-group">
        <label className="font-weight-bold mb-1">Goal Metrics</label>
        <div className="mb-1">
          <span className="font-italic">
            The primary metrics you are trying to improve with this experiment.{" "}
          </span>
          <MetricsSelectorTooltip />
        </div>
        <MetricsSelector
          selected={goalMetrics}
          onChange={setGoalMetrics}
          datasource={datasource}
          exposureQueryId={exposureQueryId}
          project={project}
          autoFocus={autoFocus}
          includeFacts={true}
        />
      </div>

      <div className="form-group">
        <label className="font-weight-bold mb-1">Secondary Metrics</label>
        <div className="mb-1">
          <span className="font-italic">
            Additional metrics to learn about experiment impacts, but not
            primary objectives.
          </span>
          <MetricsSelectorTooltip />
        </div>
        <MetricsSelector
          selected={secondaryMetrics}
          onChange={setSecondaryMetrics}
          datasource={datasource}
          exposureQueryId={exposureQueryId}
          project={project}
          includeFacts={true}
        />
      </div>

      <div className="form-group">
        <label className="font-weight-bold mb-1">Guardrail Metrics</label>
        <div className="mb-1">
          <span className="font-italic">
            Metrics you want to monitor, but are NOT specifically trying to
            improve.{" "}
          </span>
          <MetricsSelectorTooltip />
        </div>
        <MetricsSelector
          selected={guardrailMetrics}
          onChange={setGuardrailMetrics}
          datasource={datasource}
          exposureQueryId={exposureQueryId}
          project={project}
          includeFacts={true}
        />
      </div>
    </>
  );
}
