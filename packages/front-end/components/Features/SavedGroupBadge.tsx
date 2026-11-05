import React from "react";
import { LinkedEntityBadge } from "@/components/Features/EntityBadge";

interface SavedGroupBadgeProps {
  groupId: string;
  groupName: string;
}

export function SavedGroupBadge({ groupId, groupName }: SavedGroupBadgeProps) {
  return (
    <LinkedEntityBadge
      href={`/saved-groups/${groupId}`}
      title={`View Saved Group: ${groupName}`}
      label={groupName}
    />
  );
}
