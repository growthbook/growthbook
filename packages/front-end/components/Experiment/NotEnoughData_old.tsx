import { formatDistance } from "date-fns";
import { ExperimentStatus } from "back-end/types/experiment";
import { getValidDate } from "shared/dates";

export default function NotEnoughData_old({
  phaseStart,
  snapshotCreated,
  experimentStatus,
  isLatestPhase,
  minSampleSize,
  variationValue,
  baselineValue,
  newUi = false,
}: {
  snapshotCreated: Date;
  phaseStart: string;
  experimentStatus: ExperimentStatus;
  isLatestPhase: boolean;
  minSampleSize: number;
  variationValue: number;
  baselineValue: number;
  newUi?: boolean;
}) {
  const percentComplete = Math.min(
    Math.max(variationValue, baselineValue) / minSampleSize
  );

  const snapshotCreatedTime = getValidDate(snapshotCreated).getTime();

  const msRemaining =
    percentComplete > 0.1
      ? ((snapshotCreatedTime - getValidDate(phaseStart).getTime()) *
          (1 - percentComplete)) /
          percentComplete -
        (Date.now() - snapshotCreatedTime)
      : null;

  const showTimeRemaining =
    msRemaining !== null && isLatestPhase && experimentStatus === "running";

  return (
    <div>
      <div className={newUi ? "" : "mb-1"}>
        <div
          className={
            newUi
              ? "text-gray font-weight-normal"
              : "badge badge-pill badge-secondary"
          }
          style={newUi ? { fontSize: "11px", lineHeight: "14px" } : {}}
        >
          not enough data
        </div>
      </div>
      {showTimeRemaining && (
        <small className="text-muted">
          {msRemaining > 0 ? (
            <>
              <span className="nowrap">{formatDistance(0, msRemaining)}</span>{" "}
              left
            </>
          ) : (
            "try updating now"
          )}
        </small>
      )}
    </div>
  );
}
