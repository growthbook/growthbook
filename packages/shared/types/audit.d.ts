import { entityEvents, entityTypes } from "shared/constants";

export type EntityEvents = typeof entityEvents;

export type EntityType = (typeof entityTypes)[number];

export type EventTypes<K> = K extends EntityType
  ? `${K}.${EntityEvents[K][number]}`
  : never;

export type EventType = EventTypes<EntityType>;
export interface AuditUserLoggedIn {
  id: string;
  email: string;
  name: string;
}

export interface AuditUserApiKey {
  apiKey: string;
}

export interface AuditUserSystem {
  system: true;
}

export type AuditInterfaceTemplate<Entity> = Entity extends EntityType
  ? {
      id: string;
      organization: string;
      user: AuditUserLoggedIn | AuditUserApiKey | AuditUserSystem;
      event: `${Entity}.${EntityEvents[Entity][number]}`;
      entity: {
        object: Entity;
        id: string;
        name?: string;
      };
      parent?: {
        object: Entity;
        id: string;
      };
      reason?: string;
      details?: string;
      dateCreated: Date;
    }
  : never;

export type AuditInterface = AuditInterfaceTemplate<EntityType>;

export type AuditInterfaceInputTemplate<Interface> = Interface extends unknown
  ? Omit<Interface, "user" | "id" | "organization" | "dateCreated">
  : never;

export type AuditInterfaceInput = AuditInterfaceInputTemplate<AuditInterface>;
