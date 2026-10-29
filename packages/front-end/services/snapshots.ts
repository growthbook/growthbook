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

export function getResultsFreshness({
  dateCreated,
  cutoffDate,
  sourceSnapshot,
}: {
  dateCreated?: Date | string;
  cutoffDate?: Date | string | null;
  sourceSnapshot?: SourceSnapshotRef;
}): ResultsFreshness | null {
  if (!dateCreated) return null;
  const ranAt = getValidDate(dateCreated);

  if (sourceSnapshot) {
    return { kind: "derived", ranAt, asOf: sourceSnapshot.analysisEndDate };
  }
  if (cutoffDate) {
    return { kind: "cutoff", ranAt, asOf: getValidDate(cutoffDate) };
  }
  return { kind: "updated", ranAt };
}
