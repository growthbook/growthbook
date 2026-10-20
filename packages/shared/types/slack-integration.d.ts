import type { EventWebHookInterface } from "../src/validators/event-webhook";

export interface SlackIntegrationInterface {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  dateCreated: Date;
  dateUpdated: Date;
  projects: string[];
  environments: string[];
  // Concrete event names or wildcard patterns (e.g. "feature.*", "feature.revision.*").
  events: string[];
  tags: string[];
  slackAppId: string;
  slackIncomingWebHook: string;
  linkedByUserId: string;
  slackSigningKey: string;
}

export interface SlackOAuthIntegrationInterface
  extends Pick<
    EventWebHookInterface,
    | "id"
    | "name"
    | "dateCreated"
    | "dateUpdated"
    | "enabled"
    | "events"
    | "projects"
    | "environments"
    | "tags"
    | "lastRunAt"
    | "lastState"
    | "notificationSettings"
    | "slack"
  > {
  eventWebHookId: EventWebHookInterface["id"];
}
