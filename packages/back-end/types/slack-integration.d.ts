import { NotificationEventName } from "./event";

export interface SlackIntegrationInterface {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  dateCreated: Date;
  dateUpdated: Date;
  projects: string[];
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  slackIncomingWebHook: string;
  linkedByUserId: string;
  slackSigningKey: string;
}
