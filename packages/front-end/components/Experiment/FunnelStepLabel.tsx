import { ReactElement } from "react";
import { Trans } from "@lingui/react/macro";
import { ExperimentTableRow } from "@/services/experiments";

export default function FunnelStepLabel({
  label,
  row,
}: {
  label: string | ReactElement;
  row: ExperimentTableRow;
}) {
  const step = (row?.funnelStepIndex ?? 0) + 1;
  return (
    <div className="pl-4" style={{ position: "relative" }}>
      <div
        className="ml-2 font-weight-bold"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 1,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          color: "var(--color-text-high)",
        }}
      >
        {row?.label ?? label}
      </div>
      <div
        className="ml-2"
        style={{ fontSize: "0.75rem", color: "var(--color-text-low)" }}
      >
        {row?.funnelStepOptional ? (
          <Trans>Step {step} (optional)</Trans>
        ) : (
          <Trans>Step {step}</Trans>
        )}
      </div>
    </div>
  );
}
