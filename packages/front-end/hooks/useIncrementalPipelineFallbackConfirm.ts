import { useCallback, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useIncrementalPipelineUnsupportedReason } from "@/hooks/useIncrementalPipelineUnsupportedReason";

export function useIncrementalPipelineFallbackConfirm({
  experiment,
  latestStatus,
}: {
  experiment: ExperimentInterfaceStringDates | undefined;
  latestStatus?: string;
}) {
  const reason = useIncrementalPipelineUnsupportedReason(experiment);

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const resolveRef = useRef<((proceed: boolean) => void) | null>(null);

  // Passed to RefreshResultsButton as customValidation: returns true to let the
  // refresh proceed, false to abort. When a structural reason blocks incremental
  // refresh (and we're not mid-run), open the confirmation dialog and resolve
  // based on the user's choice. Mid-run updates skip the gate.
  const customValidation = useCallback((): boolean | Promise<boolean> => {
    if (!reason || latestStatus === "running") {
      return true;
    }
    // Ensure any pending requests resolve to false to avoid hanging
    resolveRef.current?.(false);
    setIsConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, [reason, latestStatus]);

  const resolve = useCallback((proceed: boolean) => {
    setIsConfirmOpen(false);
    resolveRef.current?.(proceed);
    resolveRef.current = null;
  }, []);

  const onConfirm = useCallback(() => resolve(true), [resolve]);
  const onCancel = useCallback(() => resolve(false), [resolve]);

  return { customValidation, reason, isConfirmOpen, onConfirm, onCancel };
}
