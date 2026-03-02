import { z } from "zod";
import { entityEvents, entityTypes } from "shared/constants";
import {
  auditSchema,
  auditUserApiKey,
  auditUserLoggedIn,
  auditUserSystem,
} from "shared/validators";
import { CreateProps } from "./base-model";

export type EntityEvents = typeof entityEvents;
export type EntityType = (typeof entityTypes)[number];
export type EventTypes<K> = K extends EntityType
  ? `${K}.${EntityEvents[K][number]}`
  : never;
export type EventType = EventTypes<EntityType>;
export type AuditUserLoggedIn = z.infer<typeof auditUserLoggedIn>;
export type AuditUserApiKey = z.infer<typeof auditUserApiKey>;
export type AuditUserSystem = z.infer<typeof auditUserSystem>;

type InferredAuditInterface = z.infer<typeof auditSchema>;
// Reintroduce generic typing for AuditInterface to help type narrowing based on entity type
// This relationship is validated in the zod schema at runtime but can't be inferred
export type AuditInterface<Entity extends EntityType = EntityType> = Omit<
  InferredAuditInterface,
  "event" | "entity" | "parent"
> & {
  event: EventTypes<Entity>;
  entity: {
    object: Entity;
    id: string;
    name?: string;
  };
  parent?: {
    object: Entity;
    id: string;
  };
};

export type AuditInputData = Omit<CreateProps<AuditInterface>, "user">;
