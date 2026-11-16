export const SLACK_BOT_SCOPES = [
  "chat:write",
  "files:write",
  "channels:read",
  "groups:read",
  "channels:join",
  "assistant:write",
  "im:history",
  "app_mentions:read",
  "links:read",
  "links:write",
] as const;

export type SlackBotScope = (typeof SLACK_BOT_SCOPES)[number];

export const SLACK_BOT_EVENTS = [
  "app_mention",
  "message.im",
  "app_home_opened",
  "link_shared",
] as const;

export function missingSlackBotScopes(
  granted: string | undefined,
): SlackBotScope[] {
  const scopes = new Set(
    (granted ?? "").split(",").map((scope) => scope.trim()),
  );
  return SLACK_BOT_SCOPES.filter((scope) => !scopes.has(scope));
}
