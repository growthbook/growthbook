export const entityEvents = {
  attribute: ["create", "update", "delete"],
  experiment: [
    "create",
    "update",
    "start",
    "phase",
    "phase",
    "stop",
    "status",
    "archive",
    "unarchive",
    "delete",
    "results",
    "analysis",
    "screenshot",
    "screenshot",
    "refresh",
    "launchChecklist.updated",
    "phase.delete",
    "screenshot.delete",
    "screenshot.create",
  ],
  environment: ["create", "update", "delete"],
  feature: [
    "create",
    "publish",
    "revert",
    "update",
    "toggle",
    "archive",
    "delete",
  ],
  urlRedirect: ["create", "update", "delete"],
  metric: ["autocreate", "create", "update", "delete", "analysis"],
  datasource: ["create", "update", "delete", "import"],
  comment: ["create", "update", "delete"],
  user: ["create", "update", "delete", "invite"],
  organization: ["create", "update", "delete"],
  savedGroup: ["created", "deleted", "updated"],
  archetype: ["created", "deleted", "updated"],
  team: ["create", "delete", "update"],
} as const;

export type EntityEvents = typeof entityEvents;
export const EntityType = Object.keys(entityEvents) as [keyof EntityEvents];
export type EntityType = typeof EntityType[number];

export type EventTypes<
  k extends EntityType
> = `${k}.${EntityEvents[k][number]}`;
export type EventType = EntityType extends unknown
  ? EntityEvents[EntityType][number] extends unknown
    ? `${EntityType}.${EntityEvents[EntityType][number]}`
    : never
  : never;