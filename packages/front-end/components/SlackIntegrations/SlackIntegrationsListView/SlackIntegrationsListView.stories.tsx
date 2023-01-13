import { number, text } from "@storybook/addon-knobs";
import { action } from "@storybook/addon-actions";
import { SlackIntegrationsListView } from "./SlackIntegrationsListView";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";

export default {
  component: SlackIntegrationsListView,
  title: "SlackIntegration/SlackIntegrationsListView",
};

export const Default = () => {
  const data: SlackIntegrationInterface[] = [
    {
      id: "sli-d42aa490-b771-42f6-bc1a-25a98730ec7c",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My First Slack Integration",
      description: "Alerts in the #general channel",
      project: null,
      environments: [],
      events: ["feature.updated"],
      tags: [],
      slackAppId: "A04JDLXRT9A",
      slackSigningKey: "502b5a************f2d",
      linkedByUserId: "u_sktwi1id9l7z9xkis",
    },
    {
      id: "sli-d42aa490-b771-42f6-bc1a-25a98730ec",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 2nd Slack Integration",
      description: "",
      project: "prj_sktwi76klbcpsjzu",
      environments: ["staging", "production"],
      events: ["feature.updated", "feature.created", "feature.deleted"],
      tags: ["funnel"],
      slackAppId: "A04JDLXRT9A",
      slackSigningKey: "502b5a************f2d",
      linkedByUserId: "u_sktwi1id9l7z9xkis",
    },
    {
      id: "sli-d42aa490-42f6-bc1a-25a98730ec",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 3rd Slack Integration",
      description: "",
      project: "prj_sktwi76klbcpsjzu",
      environments: ["staging", "production"],
      events: [],
      tags: [
        "alpha",
        "bravo",
        "charlie",
        "delta",
        "echo",
        "foxtrot",
        "golf",
        "hotel",
        "india",
        "juliett",
        "kilo",
        "lima",
        "mike",
        "november",
        "oscar",
        "papa",
        "quebec",
        "romeo",
        "sierra",
        "tango",
        "uniform",
        "victor",
        "whiskey",
        "xray",
        "yankee",
        "zulu",
      ],
      slackAppId: "A04JDLXRT9A",
      slackSigningKey: "502b5a************f2d",
      linkedByUserId: "u_sktwi1id9l7z9xkis",
    },
  ];
  const onClick = action("clicked!");

  return (
    <>
      <SlackIntegrationsListView
        slackIntegrations={data}
        onCreateModalOpen={action("onCreateModalOpen")}
        onModalClose={action("onCreateModalOpen")}
        errorMessage={null}
        createError={null}
        isModalOpen={false}
        onDelete={async () => {
          action("onDelete")();
        }}
        onEditModalOpen={action("onEditModalOpen")}
        onEdit={action("onEdit")}
        onAdd={action("onAdd")}
      />
    </>
  );
};

export const EmptyState = () => {
  return (
    <>
      <SlackIntegrationsListView
        onCreateModalOpen={action("onCreateModalOpen")}
        onModalClose={action("onCreateModalOpen")}
        errorMessage={null}
        createError={null}
        isModalOpen={false}
        onAdd={action("onAdd")}
        onDelete={async () => {
          action("onDelete")();
        }}
        onEditModalOpen={action("onEditModalOpen")}
        onEdit={action("onEdit")}
        slackIntegrations={[]}
      />
    </>
  );
};
