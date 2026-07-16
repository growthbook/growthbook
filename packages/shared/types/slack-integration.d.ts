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
  experiments: string[];
  metrics: string[];
  features?: string[];
  environments: string[];
  tags: string[];
  coalesceWindowMs?: number;
  slackOptions?: import("../src/validators/event-webhook").SlackEventWebHookOptions;
  lastRunAt: Date | null;
  lastState: "none" | "success" | "error";
  slack?: {
    appId?: string;
    teamId?: string;
    teamName?: string;
    enterpriseId?: string;
    enterpriseName?: string;
    channelName?: string;
    channelId?: string;
    configurationUrl?: string;
    botUserId?: string;
    authedUserId?: string;
    scope?: string;
    isEnterpriseInstall?: boolean;
  };
}
