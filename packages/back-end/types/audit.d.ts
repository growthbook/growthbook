import { EntityType, EntityEvents } from "../src/types/Audit";
export { EventType } from "../src/types/Audit";

export interface AuditUserLoggedIn {
  id: string;
  email: string;
  name: string;
}

export interface AuditUserApiKey {
  apiKey: string;
}

export type AuditInterfaceTemplate<Entity> = Entity extends EntityType
  ? {
      id: string;
      organization: string;
      user: AuditUserLoggedIn | AuditUserApiKey;
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
