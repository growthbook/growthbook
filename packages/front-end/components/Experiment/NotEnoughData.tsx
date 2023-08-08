import { formatDistance } from "date-fns";
import { RowResults } from "@/services/experiments";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export default function NotEnoughData({
  rowResults,
  showTimeRemaining = false,
  showPercentComplete = false,
}: {
  rowResults: RowResults;
  showTimeRemaining?: boolean;
  showPercentComplete?: boolean;
}) {
  const numerator = rowResults.enoughDataMeta.percentCompleteNumerator;
  const denominator = rowResults.enoughDataMeta.percentCompleteDenominator;

  return (
    <div className="not-enough-data">
      <div>
        <div
          className="font-weight-normal main-text"
          style={{ fontSize: "10.5px", lineHeight: "14px", marginLeft: -20 }}
        >
          not enough data
        </div>
      </div>
      {showTimeRemaining && rowResults.enoughDataMeta.showTimeRemaining && (
        <div className="small text-muted time-remaining">
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
        <div className="small text-muted percent-complete">
          <span className="percent-complete-numerator">{numerator}</span>{" "}
          /&nbsp;
          <span className="percent-complete-denominator">{denominator}</span>
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
