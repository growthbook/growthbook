import { useState } from "react";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function WaitingForReviewCallout({
  isOwnDraft,
  canRecallReview,
  disabled = false,
  onRecallReview,
}: {
  isOwnDraft: boolean;
  canRecallReview: boolean;
  disabled?: boolean;
  onRecallReview: () => Promise<void> | void;
}) {
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
