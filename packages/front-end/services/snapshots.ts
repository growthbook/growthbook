import { SetStateAction } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysisSettings,
} from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { getValidDate } from "shared/dates";
import { SourceSnapshotRef } from "shared/enterprise";

export async function analysisUpdate(
  newSettings: ExperimentSnapshotAnalysisSettings,
  analysis: ExperimentSnapshotAnalysis,
  snapshot: ExperimentSnapshotInterface,
  apiCall: <T>(
    url: string | null,
    options?: RequestInit | undefined,
  ) => Promise<T>,
  setPostLoading: (value: SetStateAction<boolean>) => void,
  phase?: number,
): Promise<"success" | "fail" | "abort"> {
  if (!analysis || !snapshot) return "abort";
  let status: "success" | "fail" | "abort" = "fail";

  if (!getSnapshotAnalysis(snapshot, newSettings)) {
    setPostLoading(true);
    await apiCall(`/snapshot/${snapshot.id}/analysis`, {
      method: "POST",
      body: JSON.stringify({
        analysisSettings: newSettings,
        phaseIndex: phase,
      }),
    })
      .then((resp) => {
        // @ts-expect-error the resp should have a status
        if ((resp?.status ?? 400) + "" === "200") {
          status = "success";
        } else {
          status = "fail";
        }
      })
      .catch((e) => {
        console.error(e);
        status = "fail";
      });
  } else {
    status = "success";
  }

  return status;
}

export type ResultsFreshness =
  | { kind: "updated"; ranAt: Date }
  // A breakdown computed from Overall Results is only as fresh as that data.
  | { kind: "derived"; ranAt: Date; asOf: Date }
  // Analyzed through a cutoff before the run (scheduled update lag).
  | { kind: "cutoff"; ranAt: Date; asOf: Date };

// An unlagged run's end date lands within moments of its dateCreated; only a
// real cutoff should change the headline.
const CUTOFF_DISPLAY_THRESHOLD_MS = 60 * 1000;

export function getResultsFreshness({
  dateCreated,
  analysisEndDate,
  sourceSnapshot,
  phaseEnded = false,
}: {
  dateCreated?: Date | string;
  analysisEndDate?: Date | string;
  sourceSnapshot?: SourceSnapshotRef;
  // A stopped phase's end date is when it stopped, not a cutoff, so its
  // results keep their run time.
  phaseEnded?: boolean;
}): ResultsFreshness | null {
  if (!dateCreated) return null;
  const ranAt = getValidDate(dateCreated);

  if (sourceSnapshot) {
    return { kind: "derived", ranAt, asOf: sourceSnapshot.analysisEndDate };
  }

  if (analysisEndDate && !phaseEnded) {
    const asOf = getValidDate(analysisEndDate);
    if (ranAt.getTime() - asOf.getTime() >= CUTOFF_DISPLAY_THRESHOLD_MS) {
      return { kind: "cutoff", ranAt, asOf };
    }
  }

  return { kind: "updated", ranAt };
}
