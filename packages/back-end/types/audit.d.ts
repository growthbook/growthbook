import { EntityType, EventTypes } from "../src/types/Audit";
export { EventType } from "../src/types/Audit";
import { AuditInterfaceTemplate as LegacyAuditInterfaceTemplate } from "../src/util/legacyAudit/maps";

export interface AuditUserLoggedIn {
  id: string;
  email: string;
  name: string;
}

export interface AuditUserApiKey {
  apiKey: string;
}

export type AuditInterfaceTemplate<
  Entity,
  Event = EventTypes<Entity>
> = Entity extends EntityType
  ? Event extends EventTypes<Entity>
    ? LegacyAuditInterfaceTemplate<{
        id: string;
        organization: string;
        user: AuditUserLoggedIn | AuditUserApiKey;
        event: Event;
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
      }>
    : never
  : never;

export type AuditInterface = AuditInterfaceTemplate<EntityType>;

export type AuditInterfaceInputTemplate<Interface> = Interface extends unknown
  ? Omit<Interface, "user" | "id" | "organization" | "dateCreated">
  : never;

export type AuditInterfaceInput = AuditInterfaceInputTemplate<AuditInterface>;
