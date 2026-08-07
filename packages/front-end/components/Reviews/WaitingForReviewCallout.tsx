import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

// The "your draft is with a reviewer" notice, shared by the Feature tab and the
// generic (Config / Constant / Saved Group) one.
//
// One component because the two tabs had drifted: the generic one showed nothing at
// all here, so a draft awaiting someone else's approval read as stuck, with no hint
// that withdrawing the request was even possible.
//
// The recall CTA is a Button in the Callout's `action` slot rather than a Link in the
// body: it fires an async POST, and `@/ui/Button` awaits a Promise `onClick`, showing
// a spinner and refusing a second click while it is in flight.
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
  return (
    <Callout
      status="info"
      size="sm"
      action={
        canRecallReview ? (
          <Button
            color="inherit"
            size="sm"
            disabled={disabled}
            onClick={async () => {
              await onRecallReview();
            }}
          >
            Return to draft state
          </Button>
        ) : undefined
      }
    >
      {isOwnDraft
        ? "Waiting for a reviewer — you can't approve your own draft."
        : "Waiting for a reviewer."}
    </Callout>
  );
}
