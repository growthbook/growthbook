import { formatDistance } from "date-fns";
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
}: {
  rowResults: RowResults;
  showTimeRemaining?: boolean;
  showPercentComplete?: boolean;
}) {
  const enoughDataMeta = rowResults.enoughDataMeta;
  return (
    <div className="not-enough-data">
      <div>
        <em
          className="text-muted font-weight-normal"
          style={{ fontSize: "10.5px", lineHeight: "14px" }}
        >
          Not enough data
        </em>
      </div>
      {showTimeRemaining &&
        enoughDataMeta.reason === "notEnoughData" &&
        enoughDataMeta.showTimeRemaining && (
          <div
            className="text-muted time-remaining"
            style={{ fontSize: "10.5px", lineHeight: "18px" }}
          >
            {(enoughDataMeta.timeRemainingMs ?? 0) > 0 ? (
              <>
                <span className="nowrap">
                  {formatDistance(0, enoughDataMeta.timeRemainingMs ?? 0)}
                </span>{" "}
                left
              </>
            ) : (
              "try updating now"
            )}
          </div>
        )}
      {showPercentComplete && enoughDataMeta.reason === "notEnoughData" ? (
        <div className="text-muted percent-complete small">
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
