import { OrganizationMessage } from "back-end/types/organization";
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

export const WithMarkdown = () => {
  const messages: OrganizationMessage[] = [
    {
      message:
        "## info \n\nThis is a test info message with Markdown.\n\nYou will need to perform some action.\n\n[Click here](/app/features) to do that.",
      level: "info",
    },
    {
      message:
        "## warning \n\nThis is a test warning message with Markdown.\n\nYou will need to perform some action.\n\n[Click here](/app/features) to do that.",
      level: "warning",
    },
    {
      message:
        "## danger \n\nThis is a test danger message with Markdown.\n\nYou will need to perform some action.\n\n[Click here](/app/features) to do that.",
      level: "danger",
    },
  ];

  return <OrganizationMessages messages={messages} />;
};
