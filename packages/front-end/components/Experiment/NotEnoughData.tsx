import { formatDistance } from "date-fns";

export default function NotEnoughData({
  phaseStart,
  snapshotCreated,
  experimentStatus,
  isLatestPhase,
  minSampleSize,
  variationValue,
  baselineValue,
}: {
  snapshotCreated: Date;
  phaseStart: string;
  experimentStatus: "draft" | "running" | "stopped";
  isLatestPhase: boolean;
  minSampleSize: number;
  variationValue: number;
  baselineValue: number;
}) {
  const percentComplete = Math.min(
    Math.max(variationValue, baselineValue) / minSampleSize
  );

  const snapshotCreatedTime = new Date(snapshotCreated).getTime();

  const msRemaining =
    percentComplete > 0.1
      ? ((snapshotCreatedTime - new Date(phaseStart).getTime()) *
          (1 - percentComplete)) /
          percentComplete -
        (Date.now() - snapshotCreatedTime)
      : null;

  const showTimeRemaining =
    msRemaining !== null && isLatestPhase && experimentStatus === "running";

  return (
    <div>
      <div className="mb-1">
        <div className="badge badge-pill badge-secondary">not enough data</div>
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
