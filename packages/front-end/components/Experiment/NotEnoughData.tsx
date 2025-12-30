import { formatDistance } from "date-fns";
import { CSSProperties } from "react";
import clsx from "clsx";
import { RowResults } from "@/services/experiments";

const numberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export default function NotEnoughData({
  rowResults,
  showTimeRemaining = false,
  showPercentComplete = false,
  noStyle = false,
  style,
  showBaselineZero = false,
}: {
  rowResults: RowResults;
  showTimeRemaining?: boolean;
  showPercentComplete?: boolean;
  noStyle?: boolean;
  style?: CSSProperties;
  showBaselineZero?: boolean;
}) {
  const enoughDataMeta = rowResults.enoughDataMeta;
  return (
    <div className="not-enough-data" style={style}>
      <div>
        <div
          className="font-weight-normal main-text"
          style={noStyle ? {} : { fontSize: "10.5px", lineHeight: "14px" }}
        >
          not enough data
        </div>
      </div>
      {showTimeRemaining &&
        enoughDataMeta.reason === "notEnoughData" &&
        enoughDataMeta.showTimeRemaining && (
          <div
            className={clsx("text-muted time-remaining", { small: !noStyle })}
            style={noStyle ? {} : { fontSize: "10.5px", lineHeight: "12px" }}
          >
            {(enoughDataMeta.timeRemainingMs ?? 0) > 0 ? (
              <>
                <span className="nowrap">
                  {formatDistance(0, enoughDataMeta.timeRemainingMs ?? 0)}
                </span>{" "}
                left
              </>
            ) : showBaselineZero ? (
              "0 value in baseline"
            ) : (
              "try updating now"
            )}
          </div>
        )}
      {showPercentComplete && enoughDataMeta.reason === "notEnoughData" ? (
        <div
          className={clsx("text-muted percent-complete", { small: !noStyle })}
        >
          <span className="percent-complete-numerator">
            {numberFormatter.format(enoughDataMeta.percentCompleteNumerator)}
          </span>{" "}
          /&nbsp;
          <span className="percent-complete-denominator">
            {numberFormatter.format(enoughDataMeta.percentCompleteDenominator)}
          </span>
          <span className="percent-complete-percent ml-1">
            ({percentFormatter.format(enoughDataMeta.percentComplete)})
          </span>
        </div>
      ) : null}
    </div>
  );
}
