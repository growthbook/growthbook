import React from "react";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();
  return (
    <Tooltip
      body={getShareStatusTooltip({ shareLevel, editLevel, isOwner }, i18n)}
    >
      {shareLevel === "private" ? (
        <Badge variant="soft" color="gray" label={t`Private`} radius="full" />
      ) : shareLevel === "organization" ? (
        <Badge
          variant="soft"
          color="green"
          label={t`Published`}
          radius="full"
        />
      ) : shareLevel === "public" ? (
        <Badge variant="soft" color="orange" label={t`Public`} radius="full" />
      ) : null}
    </Tooltip>
  );
}

export function getShareStatusTooltip(
  {
    shareLevel = "organization",
    editLevel,
    isOwner = true,
  }: {
    shareLevel?: "public" | "organization" | "private";
    editLevel?: "organization" | "private";
    isOwner?: boolean;
  },
  i18n: I18n,
) {
  if (shareLevel === "private") {
    if (editLevel === "organization") {
      return isOwner
        ? i18n._(
            msg`This report is unlisted — only you can view it and edit it.`,
          )
        : i18n._(
            msg`This report is unlisted — only the owner can view it and edit it.`,
          );
    }
    if (editLevel === "private") {
      return isOwner
        ? i18n._(msg`This report is unlisted — only you can view and edit it`)
        : i18n._(
            msg`This report is unlisted — only the owner can view and edit it`,
          );
    }
    return isOwner
      ? i18n._(msg`This report is unlisted — only you can view it`)
      : i18n._(msg`This report is unlisted — only the owner can view it`);
  }

  if (shareLevel === "organization") {
    if (editLevel === "organization") {
      return i18n._(
        msg`This report is discoverable within your organization. Anybody in your organization with permissions can edit it.`,
      );
    }
    if (editLevel === "private") {
      return isOwner
        ? i18n._(
            msg`This report is discoverable within your organization. Only you can edit it.`,
          )
        : i18n._(
            msg`This report is discoverable within your organization. Only the owner can edit it.`,
          );
    }
    return i18n._(msg`This report is discoverable within your organization`);
  }

  if (editLevel === "organization") {
    return i18n._(
      msg`This report is viewable by anybody with a shared link. Anybody in your organization with permissions can edit it.`,
    );
  }
  if (editLevel === "private") {
    return isOwner
      ? i18n._(
          msg`This report is viewable by anybody with a shared link. Only you can edit it.`,
        )
      : i18n._(
          msg`This report is viewable by anybody with a shared link. Only the owner can edit it.`,
        );
  }
  return i18n._(msg`This report is viewable by anybody with a shared link`);
}
