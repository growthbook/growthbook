import { OrganizationMessage } from "@/components/OrganizationMessages/types";
import { OrganizationMessages } from "./OrganizationMessages";

export default {
  component: OrganizationMessages,
  title: "In-app Messaging/OrganizationMessages",
};

export const Default = () => {
  const messages: OrganizationMessage[] = [
    {
      message: "This is a test info message for Storybook.",
      level: "info",
    },
    {
      message: "This is a test warning message for Storybook.",
      level: "warning",
    },
    {
      message: "This is a test danger message for Storybook.",
      level: "danger",
    },
  ];

  return <OrganizationMessages messages={messages} />;
};
