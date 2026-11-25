import React from "react";
import { useLingui } from "@lingui/react/macro";
import { LinkedEntityBadge } from "@/components/Features/EntityBadge";

interface AttributeBadgeProps {
  /** Attribute id/name to display and link to the attribute page. */
  attributeId: string;
}

export function AttributeBadge({ attributeId }: AttributeBadgeProps) {
  const { t } = useLingui();
  return (
    <LinkedEntityBadge
      href={`/attributes/${encodeURIComponent(attributeId)}`}
      title={t`View attribute: ${attributeId}`}
      label={attributeId}
    />
  );
}
