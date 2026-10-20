import { ReactElement } from "react";
import { ExperimentTableRow } from "@/services/experiments";

export default function FunnelStepLabel({
  label,
  row,
}: {
  label: string | ReactElement;
  row: ExperimentTableRow;
}) {
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
        Step {(row?.funnelStepIndex ?? 0) + 1}
        {row?.funnelStepOptional ? " (optional)" : ""}
      </div>
    </div>
  );
}
