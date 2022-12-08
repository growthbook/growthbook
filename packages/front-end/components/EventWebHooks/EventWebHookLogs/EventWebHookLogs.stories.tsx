import { EventWebHookLogs } from "./EventWebHookLogs";
import { EventWebHookLogInterface } from "back-end/types/event-webhook-log";
import { action } from "@storybook/addon-actions";

export default {
  component: EventWebHookLogs,
  title: "Event Webhooks/EventWebHookLogs",
};

export const Default = () => {
  const logs: EventWebHookLogInterface[] = [
    {
      id: "ewhl-f9c1e9e5-679f-4d5e-a0db-dc2972d8ab36",
      dateCreated: new Date(),
      eventWebHookId: "ewh-26cfb08b-55c6-4848-8095-1eee2da5bf60",
      organizationId: "org_sktwi1id9l7z9xkjb",
      result: "error",
      responseCode: 401,
      responseBody: "Unauthorized",
      payload: {
        object: "feature",
        event: "feature.updated",
        data: {
          current: {
            id: "a",
            description: "New description!",
            archived: false,
            dateCreated: "2022-10-11T21:09:33.791Z",
            dateUpdated: "2022-11-17T22:16:10.108Z",
            defaultValue: "false",
            environments: {
              production: {
                defaultValue: "false",
                enabled: false,
                rules: [
                  {
                    type: "force",
                    description: "",
                    id: "fr_sktwi6h9lak467jw",
                    value: "true",
                    enabled: true,
                    condition: '{"id": "1"}',
                  },
                ],
                draft: null,
                definition: null,
              },
              staging: {
                defaultValue: "false",
                enabled: true,
                rules: [],
                draft: null,
                definition: {
                  defaultValue: false,
                },
              },
            },
            owner: "T",
            project: "",
            tags: [],
            valueType: "boolean",
            revision: {
              comment: "This should fail",
              date: "2022-11-17T22:16:10.108Z",
              publishedBy: "tina@growthbook.io",
              version: 21,
            },
          },
          previous: {
            id: "a",
            description: "New description!",
            archived: false,
            dateCreated: "2022-10-11T21:09:33.791Z",
            dateUpdated: "2022-11-17T22:16:10.108Z",
            defaultValue: "false",
            environments: {
              production: {
                defaultValue: "false",
                enabled: true,
                rules: [
                  {
                    type: "force",
                    description: "",
                    id: "fr_sktwi6h9lak467jw",
                    value: "true",
                    enabled: true,
                    condition: '{"id": "1"}',
                  },
                ],
                draft: null,
                definition: {
                  defaultValue: false,
                  rules: [
                    {
                      condition: {
                        id: "1",
                      },
                      force: true,
                    },
                  ],
                },
              },
              staging: {
                defaultValue: "false",
                enabled: true,
                rules: [],
                draft: null,
                definition: {
                  defaultValue: false,
                },
              },
            },
            owner: "T",
            project: "",
            tags: [],
            valueType: "boolean",
            revision: {
              comment: "This should fail",
              date: "2022-11-17T22:16:10.108Z",
              publishedBy: "tina@growthbook.io",
              version: 21,
            },
          },
        },
      },
    },
    {
      id: "ewhl-f962fd23-fca5-4f4b-ba44-17292de3971e",
      dateCreated: new Date(),
      eventWebHookId: "ewh-26cfb08b-55c6-4848-8095-1eee2da5bf60",
      organizationId: "org_sktwi1id9l7z9xkjb",
      result: "error",
      responseCode: 401,
      responseBody: "Unauthorized",
      payload: {
        object: "feature",
        event: "feature.updated",
        data: {
          current: {
            id: "a",
            description: "New description!",
            archived: false,
            dateCreated: "2022-10-11T21:09:33.791Z",
            dateUpdated: "2022-11-17T22:16:10.108Z",
            defaultValue: "false",
            environments: {
              production: {
                defaultValue: "false",
                enabled: false,
                rules: [
                  {
                    type: "force",
                    description: "",
                    id: "fr_sktwi6h9lak467jw",
                    value: "true",
                    enabled: true,
                    condition: '{"id": "1"}',
                  },
                ],
                draft: null,
                definition: null,
              },
              staging: {
                defaultValue: "false",
                enabled: true,
                rules: [],
                draft: null,
                definition: {
                  defaultValue: false,
                },
              },
            },
            owner: "T",
            project: "",
            tags: [],
            valueType: "boolean",
            revision: {
              comment: "This should fail",
              date: "2022-11-17T22:16:10.108Z",
              publishedBy: "tina@growthbook.io",
              version: 21,
            },
          },
          previous: {
            id: "a",
            description: "New description!",
            archived: false,
            dateCreated: "2022-10-11T21:09:33.791Z",
            dateUpdated: "2022-11-17T22:16:10.108Z",
            defaultValue: "false",
            environments: {
              production: {
                defaultValue: "false",
                enabled: true,
                rules: [
                  {
                    type: "force",
                    description: "",
                    id: "fr_sktwi6h9lak467jw",
                    value: "true",
                    enabled: true,
                    condition: '{"id": "1"}',
                  },
                ],
                draft: null,
                definition: {
                  defaultValue: false,
                  rules: [
                    {
                      condition: {
                        id: "1",
                      },
                      force: true,
                    },
                  ],
                },
              },
              staging: {
                defaultValue: "false",
                enabled: true,
                rules: [],
                draft: null,
                definition: {
                  defaultValue: false,
                },
              },
            },
            owner: "T",
            project: "",
            tags: [],
            valueType: "boolean",
            revision: {
              comment: "This should fail",
              date: "2022-11-17T22:16:10.108Z",
              publishedBy: "tina@growthbook.io",
              version: 21,
            },
          },
        },
      },
    },
  ];

  return (
    <>
      <EventWebHookLogs
        logs={logs}
        activeLog={logs[0]}
        onLogItemClicked={action("Change active log to the provided log")}
      />
    </>
  );
};
