import { useEffect } from "react";
import useOrgSettings from "@/hooks/useOrgSettings";
import { MINIMUM_MULTIPLE_EXPOSURES } from "@/components/Experiment/MultipleExposureWarning";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { HealthStatus, StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  totalUsers: number;
  onNotify: (issue: IssueValue) => void;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

const multiExposureCheck = ({
  multipleExposures,
  minMultipleExposures,
  totalUsers,
  minPercent,
}): HealthStatus => {
  if (multipleExposures < minMultipleExposures) return "healthy";

  const percent = multipleExposures / (multipleExposures + totalUsers);

  if (percent < minPercent) {
    return "healthy";
  }

  return "Issues detected";
};

export default function MultipleExposuresCard({ totalUsers, onNotify }: Props) {
  const settings = useOrgSettings();
  const { snapshot } = useSnapshot();

  const MIN_PERCENT = settings?.multipleExposureMinPercent ?? 0.01;
  const health = multiExposureCheck({
    multipleExposures: snapshot?.multipleExposures,
    minMultipleExposures: MINIMUM_MULTIPLE_EXPOSURES,
    totalUsers,
    minPercent: MIN_PERCENT,
  });
  useEffect(() => {
    if (health === "Issues detected") {
      onNotify({ label: "多次曝光", value: "multipleExposures" });
    }
  }, [snapshot, health, onNotify]);

  if (!snapshot) return null;

  const { multipleExposures } = snapshot;

  return (
    <div className="appbox p-3">
      <h2 className="d-inline">多次曝光检查</h2>{" "}
      {/* <p className="d-inline text-muted">{helpText}</p> */}
      {health && health !== "healthy" && <StatusBadge status={health} />}
      <p className="mt-1">
        检测单位是否接触过多种变体
      </p>
      <hr></hr>
      <div className="row justify-content-start">
        <div className="ml-2 mr-2 mt-1 w-100">
          {health === "healthy" ? (
            <div className="alert alert-info">
              {multipleExposures === 0 ? (
                <b>未检测到多次曝光情况。</b>
              ) : (
                `${numberFormatter.format(
                  multipleExposures
                )} 次多次曝光情况被检测到，但这低于您设定的阈值 ${percentFormatter.format(
                  MIN_PERCENT
                )}`
              )}
            </div>
          ) : (
            <div className="alert alert-warning mb-0">
              <strong>多次曝光警告</strong>.{" "}
              {numberFormatter.format(multipleExposures)} 名用户 (
              {percentFormatter.format(
                multipleExposures / (multipleExposures + totalUsers)
              )}
              ) 接触过多种变体，这些用户已自动从结果中移除。请检查您的实现代码、事件跟踪或数据管道中是否存在错误。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
