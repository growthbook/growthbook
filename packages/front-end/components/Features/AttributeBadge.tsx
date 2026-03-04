import React from "react";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

interface AttributeBadgeProps {
  /** Attribute id/name to display and link to the attribute page. */
  attributeId: string;
}

/**
 * Gray badge with a link to the attribute page. Uses theme-aware styling:
 * day theme = gray badge, violet link; dark mode uses matching tokens.
 */
export function AttributeBadge({ attributeId }: AttributeBadgeProps) {
  const href = `/attributes/${encodeURIComponent(attributeId)}`;

  return (
    <Badge
      color="gray"
      label={
        <Link
          href={href}
          target="_blank"
          title={`View attribute: ${attributeId}`}
          className="hover-underline"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            overflow: "hidden",
            color: "var(--accent-11)",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "400px",
            }}
          >
            {attributeId}
          </span>
        </Link>
      }
    />
  );
}
