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
        <div className="form-group">
          <label className="font-weight-bold mb-1">
            {!forceSingleGoalMetric ? "目标指标" : "决策指标"}
          </label>
          <div className="mb-1">
            <span className="font-italic">
              {!forceSingleGoalMetric
                ? "本次实验中您试图去提升的主要指标。"
                : "选择将用于更新版本权重的目标指标。"}
            </span>
            <MetricsSelectorTooltip
              isSingular={true}
              noPercentileGoalMetrics={noPercentileGoalMetrics}
            />
          </div>
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
        <div className="form-group">
          {secondaryCollapsed ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setSecondaryCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              添加次要指标
            </a>
          ) : (
            <>
              <label className="font-weight-bold mb-1">次要指标</label>
              <div className="mb-1">
                <span className="font-italic">
                  {!forceSingleGoalMetric
                    ? "用于了解实验影响的其他指标，但并非主要目标。"
                    : "用于了解实验影响的其他指标。"}
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
                disabled={disabled}
              />
            </>
          )}
        </div>
      )}

      {setGuardrailMetrics !== undefined && (
        <div className="form-group">
          {guardrailCollapsed ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setGuardrailCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              添加护栏指标
            </a>
          ) : (
            <>
              <label className="font-weight-bold mb-1">护栏指标</label>
              <div className="mb-1">
                <span className="font-italic">
                  您想要监控的指标，但并非专门要去提升的指标。
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
                disabled={disabled}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
