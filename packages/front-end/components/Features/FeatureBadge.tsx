import React from "react";
import { LinkedEntityBadge } from "@/components/Features/EntityBadge";

interface FeatureBadgeProps {
  featureId: string;
}

export function FeatureBadge({ featureId }: FeatureBadgeProps) {
  return (
    <LinkedEntityBadge
      href={`/features/${featureId}`}
      title={`View Feature Flag: ${featureId}`}
      label={featureId}
    />
  );
}
