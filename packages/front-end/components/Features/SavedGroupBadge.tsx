import React from "react";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

interface SavedGroupBadgeProps {
  groupId: string;
  groupName: string;
}

export function SavedGroupBadge({ groupId, groupName }: SavedGroupBadgeProps) {
  return (
    <Badge
      color="gray"
      label={
        <Link
          href={`/saved-groups/${groupId}`}
          target="_blank"
          title={`View saved group: ${groupName}`}
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
            {groupName}
          </span>
        </Link>
      }
    />
  );
}
