import { formatDistance } from "date-fns";
import { CSSProperties } from "react";
import clsx from "clsx";
import { RowResults } from "@front-end/services/experiments";

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
}: {
  rowResults: RowResults;
  showTimeRemaining?: boolean;
  showPercentComplete?: boolean;
  noStyle?: boolean;
  style?: CSSProperties;
}) {
  const numerator = rowResults.enoughDataMeta.percentCompleteNumerator;
  const denominator = rowResults.enoughDataMeta.percentCompleteDenominator;

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
      {showTimeRemaining && rowResults.enoughDataMeta.showTimeRemaining && (
        <div
          className={clsx("text-muted time-remaining", { small: !noStyle })}
          style={noStyle ? {} : { fontSize: "10.5px", lineHeight: "12px" }}
        >
          {(rowResults.enoughDataMeta.timeRemainingMs ?? 0) > 0 ? (
            <>
              <span className="nowrap">
                {formatDistance(
                  0,
                  rowResults.enoughDataMeta.timeRemainingMs ?? 0
                )}
              </span>{" "}
              left
            </>
          ) : (
            "try updating now"
          )}
        </div>
      )}
      {showPercentComplete ? (
        <div
          className={clsx("text-muted percent-complete", { small: !noStyle })}
        >
          <span className="percent-complete-numerator">
            {numberFormatter.format(numerator)}
          </span>{" "}
          /&nbsp;
          <span className="percent-complete-denominator">
            {numberFormatter.format(denominator)}
          </span>
          <span className="percent-complete-percent ml-1">
            (
            {percentFormatter.format(rowResults.enoughDataMeta.percentComplete)}
            )
          </span>
        </div>
      ) : null}
    </div>
  );
}
