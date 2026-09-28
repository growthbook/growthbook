import React from "react";
import { LinkedEntityBadge } from "@/components/Features/EntityBadge";

interface AttributeBadgeProps {
  /** Attribute id/name to display and link to the attribute page. */
  attributeId: string;
}

export function AttributeBadge({ attributeId }: AttributeBadgeProps) {
  return (
    <LinkedEntityBadge
      href={`/attributes/${encodeURIComponent(attributeId)}`}
      title={`View attribute: ${attributeId}`}
      label={attributeId}
    />
  );
}
