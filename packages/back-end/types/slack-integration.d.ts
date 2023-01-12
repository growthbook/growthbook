import { NotificationEventName } from "./event";

export interface SlackIntegrationInterface {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  dateCreated: Date;
  dateUpdated: Date;
  project: string | null;
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  linkedByUserId: string;
  slackSigningKey: string;
}
