import { MetricDefaults } from "back-end/types/organization";
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
            仅适用于贝叶斯分析
          </small>
        </li>
        {metric.priorSettings?.override ? (
          <>
            <li className="mb-2">
              <span className="text-gray">Use proper prior:</span>{" "}
              <span className="font-weight-bold">
                {metric.priorSettings.proper ? "开启" : "关闭"}
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
                <em className="text-gray">使用集团默认</em>
              </div>
              <div className="ml-2 px-2 border-left">
                <div className="mb-1 small">
                  <span className="text-gray">Use proper prior:</span>{" "}
                  <span className="font-weight-bold">
                    {metricDefaults?.priorSettings?.proper ? "开启" : "关闭"}
                  </span>
                </div>
                {metricDefaults?.priorSettings?.proper ? (
                  <>
                    <div className="mb-1 small">
                      <span className="text-gray">均值:</span>{" "}
                      <span className="font-weight-bold">
                        {metricDefaults?.priorSettings.mean ?? 0}
                      </span>
                    </div>
                    <div className="mb-1 small">
                      <span className="text-gray">标准差:</span>{" "}
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
