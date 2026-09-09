import React from "react";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

interface FeatureBadgeProps {
  featureId: string;
}

export function FeatureBadge({ featureId }: FeatureBadgeProps) {
  return (
    <Badge
      color="gray"
      label={
        <Link
          href={`/features/${featureId}`}
          target="_blank"
          title={`View Feature Flag: ${featureId}`}
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
            {featureId}
          </span>
        </Link>
      }
    />
  );
}
