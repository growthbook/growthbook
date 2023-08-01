import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentStatus } from "back-end/types/experiment";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import {
  ExperimentTableRow,
  getRiskByVariation,
  hasEnoughData,
  isBelowMinChange,
  isSuspiciousUplift,
  RowResults,
  shouldHighlight as _shouldHighlight,
} from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useCurrency } from "@/hooks/useCurrency";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatConversionRate,
} from "@/services/metrics";
import NotEnoughData_new from "@/components/Experiment/NotEnoughData_new";
import Tooltip from "../Tooltip/Tooltip";
import NotEnoughData from "./NotEnoughData";
import {GBSuspicious} from "@/components/Icons";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ChanceToWinColumn_new({
  stats,
  baseline,
  rowResults,
  showRisk = true,
  showSuspicious = true,
  className,
}: {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  showRisk?: boolean;
  showSuspicious?: boolean;
  className?: string;
}) {
  const displayCurrency = useCurrency();

  return (
    <td
      className={clsx(
        "variation chance result-number align-middle",
        rowResults.resultsStatus,
        className
      )}
    >
      {!baseline?.value || !stats?.value ? (
        <em className="text-gray">no data</em>
      ) : !rowResults.enoughData ? (
        <NotEnoughData_new rowResults={rowResults} />
      ) : (
        <>
          <div
            className="d-inline-block ml-2"
            style={{ width: 50, lineHeight: "14px" }}
          >
            {percentFormatter.format(stats.chanceToWin ?? 0)}
          </div>
          {showRisk &&
          rowResults.riskMeta.showRisk &&
          ["warning", "danger"].includes(rowResults.riskMeta.riskStatus) &&
          rowResults.resultsStatus !== "lost" ? (
            <span
              className={rowResults.riskMeta.riskStatus}
              style={{ fontSize: 14, marginLeft: 1 }}
            >
              <HiOutlineExclamationCircle />
            </span>
          ) : null}
          {showSuspicious && rowResults.suspiciousChange ? (
            <span
              className="suspicious"
              style={{ fontSize: 14, marginLeft: 1 }}
            >
              <GBSuspicious/>
            </span>
          ) : null}
        </>
      )}
    </td>
  );
}
