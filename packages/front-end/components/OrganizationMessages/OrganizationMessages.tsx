import React, { FC } from "react";
import md5 from "md5";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "@/types/app-features";
import { OrganizationMessage } from "@/components/OrganizationMessages/types";

type OrganizationMessagesProps = {
  messages: OrganizationMessage[];
};

export const OrganizationMessages: FC<OrganizationMessagesProps> = ({
  messages = [],
}) => {
  return (
    <div className="mb-3">
      {messages
        .filter(
          (orgMessage) =>
            typeof orgMessage?.level === "string" &&
            typeof orgMessage?.message === "string"
        )
        .map((orgMessage) => (
          <div
            key={md5(orgMessage.message)}
            className={`alert alert-${orgMessage.level}`}
          >
            {orgMessage.message}
          </div>
        ))}
    </div>
  );
};

export const OrganizationMessagesContainer = () => {
  const growthbook = useGrowthBook<AppFeatures>();

  const messages = growthbook.getFeatureValue<OrganizationMessage[]>(
    "organization-message-list",
    []
  );

  return <OrganizationMessages messages={messages} />;
};
