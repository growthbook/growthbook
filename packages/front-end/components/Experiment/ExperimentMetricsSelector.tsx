import { useState } from "react";
import { FaPlusCircle } from "react-icons/fa";
import { Text } from "@radix-ui/themes";
import MetricsSelector from "./MetricsSelector";

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
  goalMetricsDescription?: string;
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
  goalMetricsDescription,
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
          <Text
            as="p"
            size="2"
            style={{ color: "var(--color-text-mid)" }}
            className="mb-1"
          >
            {goalMetricsDescription ? goalMetricsDescription :
              !forceSingleGoalMetric
              ? "The primary metrics you are trying to improve with this experiment. "
              : "Choose the goal metric that will be used to update variation weights. "}
          </Text>
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
              <Text
                as="p"
                size="2"
                style={{ color: "var(--color-text-mid)" }}
                className="mb-1"
              >
                {!forceSingleGoalMetric
                  ? "Additional metrics to learn about experiment impacts, but not primary objectives."
                  : "Additional metrics to learn about experiment impacts. "}
              </Text>
              <MetricsSelector
                selected={secondaryMetrics}
                onChange={setSecondaryMetrics}
                datasource={datasource}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
                disabled={disabled}
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
              <Text
                as="p"
                size="2"
                style={{ color: "var(--color-text-mid)" }}
                className="mb-1"
              >
                Metrics you want to monitor, but are NOT specifically trying to
                improve.
              </Text>
              <MetricsSelector
                selected={guardrailMetrics}
                onChange={setGuardrailMetrics}
                datasource={datasource}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
                disabled={disabled}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
