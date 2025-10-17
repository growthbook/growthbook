import React from "react";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function ShareStatusBadge({
  shareLevel = "organization",
  editLevel,
  isOwner = true,
}: {
  shareLevel?: "public" | "organization" | "private";
  editLevel?: "organization" | "private";
  isOwner?: boolean;
}) {
  return (
    <Tooltip body={getShareStatusTooltip({ shareLevel, editLevel, isOwner })}>
      {shareLevel === "private" ? (
        <Badge variant="soft" color="gray" label="Private" radius="full" />
      ) : shareLevel === "organization" ? (
        <Badge variant="soft" color="green" label="Published" radius="full" />
      ) : shareLevel === "public" ? (
        <Badge variant="soft" color="orange" label="Public" radius="full" />
      ) : null}
    </Tooltip>
  );
}

export function getShareStatusTooltip({
  shareLevel = "organization",
  editLevel,
  isOwner = true,
}: {
  shareLevel?: "public" | "organization" | "private";
  editLevel?: "organization" | "private";
  isOwner?: boolean;
}) {
  let message =
    shareLevel === "private"
      ? `This report is unlisted — only ${
          isOwner ? "you" : "the owner"
        } can view it`
      : shareLevel === "organization"
        ? "This report is discoverable within your organization"
        : "This report is viewable by anybody with a shared link";

  if (editLevel === "organization") {
    if (shareLevel === "private") {
      message += " and edit it.";
    } else {
      message += ". Anybody in your organization with permissions can edit it.";
    }
  } else if (editLevel === "private") {
    if (shareLevel === "private") {
      message = `This report is unlisted — only ${
        isOwner ? "you" : "the owner"
      } can view and edit it`;
    } else {
      message += `. Only ${isOwner ? "you" : "the owner"} can edit it.`;
    }
  }
  return message;
}
