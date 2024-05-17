import Link from "next/link";
import React, { FC } from "react";
import { SlackIntegrationInterface } from "@back-end/types/slack-integration";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EventWebHookListContainer } from "@/components/EventWebHooks/EventWebHookList/EventWebHookList";
import useApi from "@/hooks/useApi";

const WebhooksPage: FC = () => {
  const permissionsUtil = usePermissionsUtil();

  const canManageWebhooks =
    permissionsUtil.canCreateEventWebhook() ||
    permissionsUtil.canUpdateEventWebhook() ||
    permissionsUtil.canDeleteEventWebhook();

  const { data: legacySlack } = useApi<{
    slackIntegrations: SlackIntegrationInterface[];
  }>("/integrations/slack");

  if (!canManageWebhooks) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="pagecontents">
        {legacySlack?.slackIntegrations?.length ? (
          <div className="alert alert-info">
            <strong>Slack Integrations</strong> are deprecated and have been
            replaced with Event Webhooks, which offer the same functionality in
            a more flexible and powerful way. View your{" "}
            <Link href="/integrations/slack">
              existing Slack Integrations here
            </Link>
            .
          </div>
        ) : null}
        <EventWebHookListContainer />
      </div>
    </div>
  );
};
export default WebhooksPage;
