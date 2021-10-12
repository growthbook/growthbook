import React, { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import clsx from "clsx";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import AlignedGraph from "./AlignedGraph";
import { MdSwapCalls } from "react-icons/md";
import Tooltip from "../Tooltip";
import { FaQuestionCircle } from "react-icons/fa";
import DataQualityWarning from "./DataQualityWarning";
import MetricValueColumn from "./MetricValueColumn";
import { useDomain, useRiskVariation } from "../../services/experiments";
import ChanceToWinColumn from "./ChanceToWinColumn";
import PercentGraphColumn from "./PercentGraphColumn";
import RiskColumn from "./RiskColumn";

const numberFormatter = new Intl.NumberFormat();

const CompactResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
  phase?: ExperimentPhaseStringDates;
  isUpdating?: boolean;
}> = ({ snapshot, experiment, phase, isUpdating }) => {
  const { getMetricById } = useDefinitions();

  const results = snapshot.results[0];
  const variations = results?.variations || [];

  const [hasRisk, riskVariation, setRiskVariation] = useRiskVariation(
    experiment,
    variations
  );

  const domain = useDomain(experiment, variations);

  return (
    <div className="mb-4 experiment-compact-holder">
      <DataQualityWarning
        experiment={experiment}
        snapshot={snapshot}
        phase={phase}
        isUpdating={isUpdating}
      />
      <table className={`table experiment-compact aligned-graph`}>
        <thead>
          <tr>
            <th rowSpan={2} className="metric" style={{ minWidth: 125 }}>
              Metric
            </th>
            {hasRisk && (
              <th
                rowSpan={2}
                className="metric"
                style={{ maxWidth: 142, minWidth: 125 }}
              >
                Risk of Choosing&nbsp;
                <Tooltip text="How much you are likely to lose if you choose this variation and it's actually worse">
                  <FaQuestionCircle />
                </Tooltip>
                <div className="mt-1">
                  <select
                    className="form-control form-control-sm"
                    style={{ maxWidth: 150 }}
                    value={riskVariation}
                    onChange={(e) => {
                      setRiskVariation(parseInt(e.target.value));
                    }}
                  >
                    {experiment.variations.map((v, i) => (
                      <option key={v.name} value={i}>
                        {i}: {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
            )}
            {experiment.variations.map((v, i) => (
              <th colSpan={i ? 3 : 1} className="value" key={i}>
                <span className="text-muted font-weight-normal">{i}:</span>
                &nbsp;{v.name}
              </th>
            ))}
          </tr>
          <tr>
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <th className={clsx("value", `variation${i} text-center`)}>
                  Value
                </th>
                {i > 0 && (
                  <th
                    className={`variation${i} text-center`}
                    style={{ minWidth: 110 }}
                  >
                    Chance to Beat Control
                  </th>
                )}
                {i > 0 && (
                  <th className={`variation${i} text-center`}>
                    Percent Change{" "}
                    {hasRisk && (
                      <Tooltip text="The true value is more likely to be in the thicker parts of the graph">
                        <FaQuestionCircle />
                      </Tooltip>
                    )}
                  </th>
                )}
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Users</th>
            {hasRisk && <th className="empty-td"></th>}
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <td className="value">
                  {numberFormatter.format(variations[i]?.users || 0)}
                </td>
                {i > 0 && (
                  <>
                    <td className="empty-td"></td>
                    <td className="p-0">
                      <div>
                        <AlignedGraph
                          id={experiment.id + "_" + i + "_axis"}
                          domain={domain}
                          significant={true}
                          showAxis={true}
                          axisOnly={true}
                          height={45}
                        />
                      </div>
                    </td>
                  </>
                )}
              </React.Fragment>
            ))}
          </tr>
          {experiment.metrics?.map((m) => {
            const metric = getMetricById(m);
            if (!metric) return null;
            const baseline = variations[0]?.metrics?.[m];

            return (
              <tr
                key={m}
                className={clsx("metricrow", {
                  nodata: !baseline?.value,
                  inverse: metric?.inverse,
                })}
              >
                <th className="metricname">
                  {metric?.name}{" "}
                  {metric?.inverse ? (
                    <Tooltip
                      text="metric is inverse, lower is better"
                      className="inverse-indicator"
                    >
                      <MdSwapCalls />
                    </Tooltip>
                  ) : (
                    ""
                  )}
                </th>
                {hasRisk && (
                  <RiskColumn
                    baselineValue={baseline?.value}
                    metric={metric}
                    riskVariation={riskVariation}
                    variations={variations}
                  />
                )}
                {experiment.variations.map((v, i) => {
                  const stats = { ...variations[i]?.metrics?.[m] };
                  return (
                    <React.Fragment key={i}>
                      <MetricValueColumn
                        metric={metric}
                        stats={stats}
                        users={variations[i].users}
                        className="value variation"
                      />
                      {i > 0 && (
                        <ChanceToWinColumn
                          baseline={baseline}
                          stats={stats}
                          experiment={experiment}
                          metric={metric}
                          phase={snapshot.phase}
                          snapshotDate={snapshot.dateCreated}
                        />
                      )}
                      {i > 0 && (
                        <PercentGraphColumn
                          baseline={baseline}
                          domain={domain}
                          experiment={experiment}
                          metric={metric}
                          stats={stats}
                          variation={i}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
export default CompactResults;
