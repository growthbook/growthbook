import { action } from "@storybook/addon-actions";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";
import { SlackIntegrationsListView } from "./SlackIntegrationsListView";

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
      projects: [],
      environments: [],
      events: ["feature.updated"],
      tags: [],
      slackAppId: "A04JDLXRT9A",
      slackSigningKey: "502b5a************f2d",
      slackIncomingWebHook:
        "https://hooks.slack.com/services/:someid:/:someotherid:/:somethingelse",
      linkedByUserId: "u_sktwi1id9l7z9xkis",
    },
    {
      id: "sli-d42aa490-b771-42f6-bc1a-25a98730ec",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 2nd Slack Integration",
      description: "",
      projects: ["prj_sktwi76klbcpsjzu"],
      environments: ["staging", "production"],
      events: ["feature.updated", "feature.created", "feature.deleted"],
      tags: ["funnel"],
      slackAppId: "A04JDLXRT9A",
      slackSigningKey: "502b5a************f2d",
      slackIncomingWebHook:
        "https://hooks.slack.com/services/:someid:/:someotherid:/:somethingelse",
      linkedByUserId: "u_sktwi1id9l7z9xkis",
    },
    {
      id: "sli-d42aa490-42f6-bc1a-25a98730ec",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 3rd Slack Integration",
      description: "",
      projects: ["prj_sktwi76klbcpsjzu"],
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
      slackIncomingWebHook:
        "https://hooks.slack.com/services/:someid:/:someotherid:/:somethingelse",
      linkedByUserId: "u_sktwi1id9l7z9xkis",
    },
  ];

  return (
    <>
      <SlackIntegrationsListView
        slackIntegrations={data}
        onCreateModalOpen={action("onCreateModalOpen")}
        onModalClose={action("onCreateModalOpen")}
        errorMessage={null}
        modalError={null}
        modalMode={null}
        onDelete={async () => {
          action("onDelete")();
        }}
        onEditModalOpen={action("onEditModalOpen")}
        onUpdate={action("onUpdate")}
        onCreate={action("onCreate")}
        environments={["staging", "production"]}
        projects={[]}
        tagOptions={[]}
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
        modalError={null}
        modalMode={null}
        onCreate={action("onCreate")}
        onDelete={async () => {
          action("onDelete")();
        }}
        onEditModalOpen={action("onEditModalOpen")}
        onUpdate={action("onUpdate")}
        slackIntegrations={[]}
        environments={["staging", "production"]}
        projects={[]}
        tagOptions={[]}
      />
    </>
  );
};
