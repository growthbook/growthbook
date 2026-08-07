import { useState } from "react";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

// The "your draft is with a reviewer" notice, shared by the Feature tab and the
// generic (Config / Constant / Saved Group) one.
//
// One component because the two tabs had drifted: the generic one showed nothing at
// all here, so a draft awaiting someone else's approval read as stuck, with no hint
// that withdrawing the request was even possible.
export default function WaitingForReviewCallout({
  isOwnDraft,
  canRecallReview,
  disabled = false,
  onRecallReview,
}: {
  // The viewer wrote this draft, so they cannot be its reviewer.
  isOwnDraft: boolean;
  canRecallReview: boolean;
  // Another action on this tab is already in flight.
  disabled?: boolean;
  onRecallReview: () => Promise<void> | void;
}) {
  // The recall's OWN in-flight state. The `disabled` prop covers the tab's other
  // actions, but nothing was tracking this one — and the link fires an async POST,
  // so without it a second click submitted again.
  const [recalling, setRecalling] = useState(false);
  const inactive = disabled || recalling;

  return (
    <Callout status="info" size="sm">
      {isOwnDraft
        ? "Waiting for a reviewer — you can't approve your own draft."
        : "Waiting for a reviewer."}
      {canRecallReview && (
        <>
          {" "}
          <Link
            color={inactive ? "gray" : undefined}
            style={inactive ? { pointerEvents: "none" } : undefined}
            aria-disabled={inactive}
            onClick={
              inactive
                ? undefined
                : async () => {
                    setRecalling(true);
                    try {
                      await onRecallReview();
                    } finally {
                      setRecalling(false);
                    }
                  }
            }
          >
            Return to draft state
          </Link>
        </>
      )}
    </Callout>
  );
}
