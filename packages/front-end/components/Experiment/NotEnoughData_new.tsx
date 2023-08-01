import { formatDistance } from "date-fns";
import { ExperimentStatus } from "back-end/types/experiment";
import { getValidDate } from "shared/dates";
import { RowResults } from "@/services/experiments";

export default function NotEnoughData_new({
  rowResults,
}: {
  rowResults: RowResults;
}) {
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
      {rowResults.enoughDataMeta.showTimeRemaining && (
        <small className="text-muted">
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
    </>
  );
}
