import React from "react";
import { SnapshotRunnerInfo } from "shared/validators";
import Callout from "@/ui/Callout";
import { getFallbackCopy } from "./incrementalFallbackCopy";

export default function IncrementalRefreshFallbackCallout({
  nextUpdatePlan,
  dimension,
}: {
  nextUpdatePlan: SnapshotRunnerInfo | null;
  dimension?: string;
}): React.ReactElement | null {
  if (!nextUpdatePlan) return null;
  if (dimension) return null;
  if (nextUpdatePlan.runner !== "inline") return null;
  if (!nextUpdatePlan.fallback) return null;

  const copy = getFallbackCopy(nextUpdatePlan.fallback.code);

  if (copy.visibility === "none") return null;

  if (copy.visibility === "muted") {
    return (
      <span style={{ fontSize: "12px", color: "var(--gray-11)" }}>
        {copy.summary}
      </span>
    );
  }

  return (
    <Callout status="warning" size="sm" contentsAs="div">
      <div>
        <div style={{ fontWeight: 500 }}>{copy.summary}</div>
        <div>{copy.detail}</div>
      </div>
    </Callout>
  );
}
