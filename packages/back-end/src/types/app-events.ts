// Every event the back end logs, mapped to its properties. `logEvent` and the
// trackEvent helpers are checked against this, so a new event has to be added
// here first.
export type AppEvents = {
  "AI Usage": {
    type: string;
    model: string;
    provider?: string;
    numPromptTokensUsed?: number;
    numCompletionTokensUsed?: number;
    numRetriedTokensUsed?: number;
    numCacheReadTokens?: number;
    numCacheWriteTokens?: number;
    spendUsd?: number;
    usedDefaultPrompt: boolean;
    usedOwnKey: boolean;
    outcome: string;
  };
  "Experiment Started": {
    source: string;
    hasDatasource: boolean;
    hasExperimentAssignmentQuery: boolean;
  };
  "Experiment Stopped": {
    source: string;
    result?: string;
  };
  "MCP Request": {
    tool: string;
    mcpVersion?: string;
    transport?: string;
    client?: string;
    authType: string;
    apiKeyId?: string;
    path: string;
    method: string;
    statusCode: number;
    latencyMs: number;
  };
  "Request Completed": {
    path: string;
    method: string;
    statusCode: number;
    latencyMs: number;
    reqContentSize?: number;
    resContentSize: number;
  };
  // One event per revision action, e.g. "Revision Review Requested"
  [name: `Revision ${string}`]: {
    resource: string;
    action: string;
    actor: string;
    entity_id_hash?: string;
    revision_id_hash?: string;
    revision_version?: number;
  };
};

export type AppEventName = keyof AppEvents;

declare module "@growthbook/growthbook" {
  interface Register {
    events: AppEvents;
  }
}
