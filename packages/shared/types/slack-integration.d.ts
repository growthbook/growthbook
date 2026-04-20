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
