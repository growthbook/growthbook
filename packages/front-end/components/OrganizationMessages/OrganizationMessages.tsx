import React, { FC, useMemo } from "react";
import md5 from "md5";
import { OrganizationMessage } from "back-end/types/organization";
import { useUser } from "@front-end/services/UserContext";
import Markdown from "@front-end/components/Markdown/Markdown";

type OrganizationMessagesProps = {
  messages: OrganizationMessage[];
};

export const OrganizationMessages: FC<OrganizationMessagesProps> = ({
  messages = [],
}) => {
  const renderedMessages = useMemo(
    () =>
      messages.filter(
        (orgMessage) =>
          typeof orgMessage?.level === "string" &&
          typeof orgMessage?.message === "string"
      ),
    [messages]
  );

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
