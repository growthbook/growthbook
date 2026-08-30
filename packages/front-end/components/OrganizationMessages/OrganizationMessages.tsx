import React, { FC, useMemo } from "react";
import md5 from "md5";
import { OrganizationMessage } from "shared/types/organization";
import { useUser } from "@/services/UserContext";
import Markdown from "@/components/Markdown/Markdown";
import Callout from "@/ui/Callout";
import { Status } from "@/ui/HelperText";

type OrganizationMessagesProps = {
  messages: OrganizationMessage[];
};

const statusMap: Record<OrganizationMessage["level"], Status> = {
  info: "info",
  warning: "warning",
  danger: "error",
};

export const OrganizationMessages: FC<OrganizationMessagesProps> = ({
  messages = [],
}) => {
  const renderedMessages = useMemo(
    () =>
      messages.filter(
        (orgMessage) =>
          typeof orgMessage?.level === "string" &&
          typeof orgMessage?.message === "string",
      ),
    [messages],
  );

  if (!renderedMessages.length) {
    return null;
  }

  return (
    <div className="contents pagecontents container mb-3">
      {renderedMessages.map((orgMessage) => (
        <Callout
          key={md5(orgMessage.message)}
          status={statusMap[orgMessage.level] || "info"}
        >
          <Markdown>{orgMessage.message}</Markdown>
        </Callout>
      ))}
    </div>
  );
};

export const OrganizationMessagesContainer = () => {
  const user = useUser();

  const messages = user?.organization?.messages || [];

  return <OrganizationMessages messages={messages} />;
};
