import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import React, { useImperativeHandle } from "react";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import SharedRevisionTimeline from "@/components/Reviews/RevisionTimeline";

// Imperative handle so the feature page can refetch the log after actions it
// drives elsewhere (e.g. submitting a comment from the composer below).
export type MutateLog = {
  mutateLog: () => Promise<void>;
};

// Re-exported for ReviewAndPublish, which builds the Conversation tab's
// collapse predicate from this set.
export { REVIEW_ACTIVITY_ACTIONS } from "@/components/Reviews/RevisionTimeline";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  // Called after timeline-initiated actions that mutate the revision itself
  // (e.g. retracting a verdict via the comment-card overflow). Lets the
  // parent refetch its revision data so status-dependent UI updates.
  onRevisionMutate?: () => void | Promise<void>;
  // When provided, entries failing the predicate are collapsed into
  // "N other events" toggles (one per consecutive run, within each date
  // group) instead of rendering inline. The verdict-retraction scan still
  // runs over the full log so review-state badges stay correct.
  collapseFilter?: (log: RevisionLog) => boolean;
}

// Feature wrapper around the shared <RevisionTimeline>: owns the feature log
// fetch and wires the feature's own endpoints (edit/delete a log entry, undo a
// review) as callbacks. The rendering and all timeline behavior live in the
// shared component.
const Revisionlog: React.ForwardRefRenderFunction<MutateLog, Props> = (
  { feature, revision, onRevisionMutate, collapseFilter },
  ref,
) => {
  const { data, error, mutate } = useApi<{ log: RevisionLog[] }>(
    `/feature/${feature.id}/${revision.version}/log`,
  );
  const { apiCall } = useAuth();
  useImperativeHandle(ref, () => ({
    async mutateLog() {
      await mutate();
    },
  }));

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <SharedRevisionTimeline
      logs={data.log}
      collapseFilter={collapseFilter}
      onEditComment={async (logId, comment) => {
        await apiCall(
          `/feature/${feature.id}/${revision.version}/log/${logId}`,
          {
            method: "PUT",
            body: JSON.stringify({ comment }),
          },
        );
        await mutate();
      }}
      onDeleteComment={async (logId) => {
        await apiCall(
          `/feature/${feature.id}/${revision.version}/log/${logId}`,
          {
            method: "DELETE",
          },
        );
        await mutate();
      }}
      onRetractVerdict={async () => {
        await apiCall(
          `/feature/${feature.id}/${revision.version}/undo-review`,
          {
            method: "POST",
          },
        );
        await mutate();
        await onRevisionMutate?.();
      }}
    />
  );
};
export default React.forwardRef(Revisionlog);
