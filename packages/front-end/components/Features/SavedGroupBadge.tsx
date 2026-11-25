import React from "react";
import { useLingui } from "@lingui/react/macro";
import { LinkedEntityBadge } from "@/components/Features/EntityBadge";

interface SavedGroupBadgeProps {
  groupId: string;
  groupName: string;
}

export function SavedGroupBadge({ groupId, groupName }: SavedGroupBadgeProps) {
  const { t } = useLingui();
  return (
    <LinkedEntityBadge
      href={`/saved-groups/${groupId}`}
      title={t`View Saved Group: ${groupName}`}
      label={groupName}
    />
  );
}
