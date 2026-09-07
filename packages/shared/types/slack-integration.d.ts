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

export interface SlackOAuthIntegrationInterface {
  id: string;
  eventWebHookId: string;
  name: string;
  dateCreated: Date;
  dateUpdated: Date;
  enabled: boolean;
  events: string[];
  projects: string[];
  environments: string[];
  tags: string[];
  lastRunAt: Date | null;
  lastState: "none" | "success" | "error";
  slackOptions?: EventWebHookInterface["slackOptions"];
  slack?: EventWebHookInterface["slack"];
}
