import { number, text } from "@storybook/addon-knobs";
import { action } from "@storybook/addon-actions";
import { SlackIntegrationAddEditModal } from "./SlackIntegrationAddEditModal";
import { FeatureEnvironment } from "back-end/types/feature";
import { TagInterface } from "back-end/types/tag";

export default {
  component: SlackIntegrationAddEditModal,
  title: "SlackIntegration/SlackIntegrationAddEditModal",
};

const environmentSettings: Record<string, FeatureEnvironment> = {
  production: {
    enabled: true,
    rules: [],
  },
  staging: {
    enabled: false,
    rules: [],
  },
  development: {
    enabled: true,
    rules: [],
  },
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
      environmentSettings={environmentSettings}
      isOpen={true}
      mode={{ mode: "create" }}
      onSubmit={action("onSubmit")}
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
