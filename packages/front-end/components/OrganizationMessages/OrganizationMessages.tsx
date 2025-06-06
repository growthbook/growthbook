import React, { FC, useMemo } from "react";
import md5 from "md5";
import {
  OrganizationInterface,
  OrganizationMessage,
} from "back-end/types/organization";
import { SubscriptionInfo } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import Markdown from "@/components/Markdown/Markdown";

type OrganizationMessagesProps = {
  messages: OrganizationMessage[];
};

// Helper function to check if user should see the Vercel readonly member message
function shouldShowVercelReadonlyMessage(
  organization: Partial<OrganizationInterface>,
  subscription: SubscriptionInfo | null,
  userRole: string | undefined
): boolean {
  // Check if this is a Vercel-managed organization
  if (!organization?.isVercelIntegration) return false;

  // Check if there's no active subscription
  if (subscription?.status === "active") return false;

  // Check if the current user has a readonly role
  if (userRole !== "readonly") return false;

  return true;
}

export const OrganizationMessages: FC<OrganizationMessagesProps> = ({
  messages = [],
}) => {
  const { organization, subscription, user } = useUser();

  const shouldShowVercelMessage = useMemo(
    () =>
      shouldShowVercelReadonlyMessage(organization, subscription, user?.role),
    [organization, subscription, user?.role]
  );

  const renderedMessages = useMemo(() => {
    const orgMessages = messages.filter(
      (orgMessage) =>
        typeof orgMessage?.level === "string" &&
        typeof orgMessage?.message === "string"
    );

    // Add the Vercel readonly message if conditions are met
    if (shouldShowVercelMessage) {
      const vercelReadonlyMessage: OrganizationMessage = {
        message:
          "You have read-only access because this Vercel-managed organization is on the free plan, which is limited to 3 full members. To get full access, ask an admin to upgrade to a paid plan or remove other members.",
        level: "info",
      };

      return [vercelReadonlyMessage, ...orgMessages];
    }

    return orgMessages;
  }, [messages, shouldShowVercelMessage]);

  if (!renderedMessages.length) {
    return null;
  }

  return (
    <div className="contents pagecontents container mb-3">
      {renderedMessages.map((orgMessage) => (
        <div
          key={md5(orgMessage.message)}
          className={`alert alert-${orgMessage.level}`}
        >
          <Markdown>{orgMessage.message}</Markdown>
        </div>
      ))}
    </div>
  );
};

export const OrganizationMessagesContainer = () => {
  const user = useUser();

  const messages = user?.organization?.messages || [];

  return <OrganizationMessages messages={messages} />;
};
