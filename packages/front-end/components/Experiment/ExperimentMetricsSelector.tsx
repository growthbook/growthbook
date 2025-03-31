import { useState } from "react";
import { FaPlusCircle } from "react-icons/fa";
import MetricsSelector, { MetricsSelectorTooltip } from "./MetricsSelector";

export interface Props {
  datasource?: string;
  exposureQueryId?: string;
  project?: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  setGoalMetrics?: (goalMetrics: string[]) => void;
  setSecondaryMetrics?: (secondaryMetrics: string[]) => void;
  setGuardrailMetrics?: (guardrailMetrics: string[]) => void;
  autoFocus?: boolean;
  forceSingleGoalMetric?: boolean;
  noPercentileGoalMetrics?: boolean;
  disabled?: boolean;
  goalDisabled?: boolean;
  collapseSecondary?: boolean;
  collapseGuardrail?: boolean;
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
  forceSingleGoalMetric = false,
  noPercentileGoalMetrics = false,
  disabled,
  goalDisabled,
  collapseSecondary,
  collapseGuardrail,
}: Props) {
  const [secondaryCollapsed, setSecondaryCollapsed] = useState<boolean>(
    !!collapseSecondary && secondaryMetrics.length === 0
  );
  const [guardrailCollapsed, setGuardrailCollapsed] = useState<boolean>(
    !!collapseGuardrail && guardrailMetrics.length === 0
  );
  return (
    <>
      {setGoalMetrics !== undefined && (
        <div className="form-group flex-1">
          <label className="font-weight-bold mb-1">
            {!forceSingleGoalMetric ? "Goal Metrics" : "Decision Metric"}
          </label>
          <MetricsSelector
            selected={goalMetrics}
            onChange={setGoalMetrics}
            datasource={datasource}
            exposureQueryId={exposureQueryId}
            project={project}
            autoFocus={autoFocus}
            includeFacts={true}
            forceSingleMetric={forceSingleGoalMetric}
            includeGroups={!forceSingleGoalMetric}
            noPercentile={noPercentileGoalMetrics}
            disabled={disabled || goalDisabled}
            helpText={
              <>
                <span>
                  {!forceSingleGoalMetric
                    ? "The primary metrics you are trying to improve with this experiment. "
                    : "Choose the goal metric that will be used to update variation weights. "}
                </span>
                <MetricsSelectorTooltip
                  isSingular={true}
                  noPercentileGoalMetrics={noPercentileGoalMetrics}
                />
              </>
            }
          />
        </div>
      )}

      {setSecondaryMetrics !== undefined && (
        <div className="form-group flex-1">
          {secondaryCollapsed ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setSecondaryCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              Add Secondary Metrics
            </a>
          ) : (
            <>
              <label className="font-weight-bold mb-1">Secondary Metrics</label>
              <MetricsSelector
                selected={secondaryMetrics}
                onChange={setSecondaryMetrics}
                datasource={datasource}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
                disabled={disabled}
                helpText={
                  <>
                    <span>
                      {!forceSingleGoalMetric
                        ? "Additional metrics to learn about experiment impacts, but not primary objectives. "
                        : "Additional metrics to learn about experiment impacts. "}
                    </span>
                    <MetricsSelectorTooltip />
                  </>
                }
              />
            </>
          )}
        </div>
      )}

      {setGuardrailMetrics !== undefined && (
        <div className="form-group flex-1">
          {guardrailCollapsed ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setGuardrailCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              Add Guardrail Metrics
            </a>
          ) : (
            <>
              <label className="font-weight-bold mb-1">Guardrail Metrics</label>
              <MetricsSelector
                selected={guardrailMetrics}
                onChange={setGuardrailMetrics}
                datasource={datasource}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
                disabled={disabled}
                helpText={
                  <>
                    <span>
                      Metrics you want to monitor, but are NOT specifically
                      trying to improve.{" "}
                    </span>
                    <MetricsSelectorTooltip />
                  </>
                }
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
