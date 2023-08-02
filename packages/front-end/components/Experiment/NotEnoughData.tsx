import { formatDistance } from "date-fns";
import { MetricInterface } from "back-end/types/metric";
import { RowResults } from "@/services/experiments";
import { useCurrency } from "@/hooks/useCurrency";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export default function NotEnoughData({
  rowResults,
  metric,
  showTimeRemaining = false,
  showPercentComplete = false,
}: {
  rowResults: RowResults;
  metric: MetricInterface;
  showTimeRemaining?: boolean;
  showPercentComplete?: boolean;
}) {
  const displayCurrency = useCurrency();

  const numerator = rowResults.enoughDataMeta.percentCompleteNumerator;
  const denominator = rowResults.enoughDataMeta.percentCompleteDenominator;

  console.log({ type: metric, numerator, displayCurrency });

  return (
    <>
      <div>
        <div
          className="text-gray font-weight-normal"
          style={{ fontSize: "11px", lineHeight: "14px" }}
        >
          not enough data
        </div>
      </div>
      {showTimeRemaining && rowResults.enoughDataMeta.showTimeRemaining && (
        <small className="text-muted time-remaining">
          {rowResults.enoughDataMeta.timeRemainingMs > 0 ? (
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
        </small>
      )}
      {showPercentComplete ? (
        <small className="text-muted percent-complete">
          <span className="percent-complete-numerator">{numerator}</span>{" "}
          /&nbsp;
          <span className="percent-complete-denominator">{denominator}</span>
          <span className="percent-complete-percent ml-1">
            (
            {percentFormatter.format(rowResults.enoughDataMeta.percentComplete)}
            )
          </span>
        </small>
      ) : null}
    </>
  );
}
