import { MetricDefaults } from "shared/types/organization";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ExperimentMetricInterface } from "shared/experiments";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";

export default function MetricPriorRightRailSectionGroup({
  metric,
  metricDefaults,
}: {
  metric: ExperimentMetricInterface;
  metricDefaults: MetricDefaults;
}) {
  return (
    <RightRailSectionGroup type="custom" empty="">
      <ul className="right-rail-subsection list-unstyled mb-2">
        <li className="mt-3 mb-2">
          <span className="uppercase-title lg">Priors</span>
          <small className="d-block mb-1 text-muted">
            Only applicable to Bayesian analyses
          </small>
        </li>
        {metric.priorSettings?.override ? (
          <>
            <li className="mb-2">
              <span className="text-gray">Use proper prior:</span>{" "}
              <span className="font-weight-bold">
                {metric.priorSettings.proper ? "On" : "Off"}
              </span>
            </li>
            {metric.priorSettings.proper ? (
              <>
                <li className="mb-2">
                  <span className="text-gray">Mean:</span>{" "}
                  <span className="font-weight-bold">
                    {metric.priorSettings.mean}
                  </span>
                </li>
                <li className="mb-2">
                  <span className="text-gray">Standard Deviation:</span>{" "}
                  <span className="font-weight-bold">
                    {metric.priorSettings.stddev}
                  </span>
                </li>
              </>
            ) : null}
          </>
        ) : (
          <>
            <li className="mb-1">
              <div className="mb-1">
                <em className="text-gray">Using organization defaults</em>
              </div>
              <div className="ml-2 px-2 border-left">
                <div className="mb-1 small">
                  <span className="text-gray">Use proper prior:</span>{" "}
                  <span className="font-weight-bold">
                    {metricDefaults?.priorSettings?.proper ? "On" : "Off"}
                  </span>
                </div>
                {metricDefaults?.priorSettings?.proper ? (
                  <>
                    <div className="mb-1 small">
                      <span className="text-gray">Mean:</span>{" "}
                      <span className="font-weight-bold">
                        {metricDefaults?.priorSettings.mean ?? 0}
                      </span>
                    </div>
                    <div className="mb-1 small">
                      <span className="text-gray">Standard Deviation:</span>{" "}
                      <span className="font-weight-bold">
                        {metricDefaults?.priorSettings.stddev ??
                          DEFAULT_PROPER_PRIOR_STDDEV}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          </>
        )}
      </ul>
    </RightRailSectionGroup>
  );
}
