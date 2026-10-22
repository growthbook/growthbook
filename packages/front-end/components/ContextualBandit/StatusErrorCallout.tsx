import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

// Shared across the contextual-bandit Results and Health tabs so the severity,
// copy, and recovery action for a failed status fetch stay in sync.
export default function StatusErrorCallout({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => Promise<unknown>;
}) {
  return (
    <Callout
      status="error"
      mb="3"
      action={
        <Button
          variant="soft"
          color="inherit"
          size="sm"
          onClick={async () => {
            await onRetry();
          }}
        >
          Retry
        </Button>
      }
    >
      Could not load the latest run status, so the information below may be out
      of date: {error.message}
    </Callout>
  );
}
