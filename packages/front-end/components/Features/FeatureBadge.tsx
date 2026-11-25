import React from "react";
import { useLingui } from "@lingui/react/macro";
import { LinkedEntityBadge } from "@/components/Features/EntityBadge";

interface FeatureBadgeProps {
  featureId: string;
}

export function FeatureBadge({ featureId }: FeatureBadgeProps) {
  const { t } = useLingui();
  return (
    <LinkedEntityBadge
      href={`/features/${featureId}`}
      title={t`View Feature Flag: ${featureId}`}
      label={featureId}
    />
  );
}
