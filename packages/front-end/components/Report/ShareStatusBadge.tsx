import React from "react";
import Badge from "@/components/Radix/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function ShareStatusBadge({
  shareLevel = "organization",
  editLevel,
}: {
  shareLevel?: "public" | "organization" | "private";
  editLevel?: "organization" | "private";
}) {
  return (
    <Tooltip body={getShareStatusTooltip({ shareLevel, editLevel })}>
      {shareLevel === "private" ? (
        <Badge variant="soft" color="gray" label="Private" radius="full" />
      ) : shareLevel === "organization" ? (
        <Badge variant="soft" label="Published" radius="full" />
      ) : shareLevel === "public" ? (
        <Badge variant="soft" color="orange" label="Public" radius="full" />
      ) : null}
    </Tooltip>
  );
}

export function getShareStatusTooltip({
  shareLevel = "organization",
  editLevel,
}: {
  shareLevel?: "public" | "organization" | "private";
  editLevel?: "organization" | "private";
}) {
  let message =
    shareLevel === "private"
      ? "This report is unlisted — only you can view it"
      : shareLevel === "organization"
      ? "This report is discoverable within your organization"
      : "This report is viewable by anybody with a shared link";

  if (editLevel === "organization") {
    message += ". Anybody in your organization with edit permissions can edit.";
  } else if (editLevel === "private") {
    if (shareLevel === "private") {
      message = "This report is unlisted — only you can view and edit it";
    } else {
      message += ". Only you can edit it.";
    }
  }
  return message;
}
