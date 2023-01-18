import { action } from "@storybook/addon-actions";
import { TagInterface } from "back-end/types/tag";
import { SlackIntegrationAddEditModal } from "./SlackIntegrationAddEditModal";

export default {
  component: SlackIntegrationAddEditModal,
  title: "SlackIntegration/SlackIntegrationAddEditModal",
};

const tagOptions: TagInterface[] = [
  {
    id: "red",
    description: "",
    color: "#FF0047",
  },
  {
    id: "orange",
    description: "",
    color: "#FF7500",
  },
  {
    id: "yellow",
    description: "",
    color: "#FFD900",
  },
  {
    id: "green",
    description: "",
    color: "#00FF04",
  },
  {
    id: "blue",
    description: "",
    color: "#006EFF",
  },
  {
    id: "purple",
    description: "",
    color: "#9E00FF",
  },
];

export const Create = () => {
  return (
    <SlackIntegrationAddEditModal
      environments={["staging", "production", "development"]}
      isOpen={true}
      mode={{ mode: "create" }}
      onCreate={action("onCreate")}
      onUpdate={action("onUpdate")}
      onClose={action("onClose")}
      tagOptions={tagOptions}
      projects={[
        {
          id: "prj_abc123",
          name: "Onboarding v2",
        },
        {
          id: "prj_xyz987",
          name: "Checkout v5",
        },
      ]}
      error={null}
    />
  );
};

export const Edit = () => {
  return (
    <SlackIntegrationAddEditModal
      environments={["staging", "production", "development"]}
      isOpen={true}
      mode={{
        mode: "edit",
        id: "sli-abc123",
        data: {
          name: "My 2nd Integration",
          description: "Alerts in the #general channel",
          environments: ["production"],
          events: ["feature.created"],
          projects: ["prj_abc123"],
          tags: ["red", "purple"],
          slackAppId: "A04***",
          slackSigningKey: "abc**********",
          slackIncomingWebHook:
            "https://hooks.slack.com/services/:someid:/:someotherid:/:somethingelse",
        },
      }}
      onCreate={action("onCreate")}
      onUpdate={action("onUpdate")}
      onClose={action("onClose")}
      tagOptions={tagOptions}
      projects={[
        {
          id: "prj_abc123",
          name: "Onboarding v2",
        },
        {
          id: "prj_xyz987",
          name: "Checkout v5",
        },
      ]}
      error={null}
    />
  );
};
