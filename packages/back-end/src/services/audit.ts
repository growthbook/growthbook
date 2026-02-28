import { EntityType, EventType, EventTypes } from "shared/types/audit";
import { entityTypes } from "shared/constants";
import { getWatchedByUser } from "back-end/src/models/WatchModel";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

export function isValidAuditEntityType(type: string): type is EntityType {
  return entityTypes.includes(type as EntityType);
}

export async function getRecentWatchedAudits(
  context: ReqContext,
  userId: string,
) {
  const userWatches = await getWatchedByUser(context.org.id, userId);

  if (!userWatches) {
    return [];
  }
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7);

  const experiments = await context.models.audits.findAuditByEntityList({
    type: "experiment",
    ids: userWatches.experiments,
    minDateCreated: startTime,
    eventList: [
      "experiment.start",
      "experiment.stop",
      "experiment.phase",
      "experiment.results",
    ],
  });

  const features = await context.models.audits.findAuditByEntityList({
    type: "feature",
    ids: userWatches.features,
    minDateCreated: startTime,
    eventList: [
      "feature.publish",
      "feature.update",
      "feature.toggle",
      "feature.create",
      "feature.delete",
    ],
  });

  const all = experiments
    .concat(features)
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime());
  return all;
}

export function auditDetailsCreate<T>(
  post: T,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    post,
    context,
  });
}
export function auditDetailsUpdate<T>(
  pre: T,
  post: T,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    pre,
    post,
    context,
  });
}

export function auditDetailsDelete<T>(
  pre: T,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    pre,
    context,
  });
}

export type AuditLogConfig<Entity extends EntityType> = {
  entity: Entity;
  createEvent: EventTypes<Entity>;
  updateEvent: EventTypes<Entity>;
  deleteEvent: EventTypes<Entity>;
  autocreateEvent?: EventTypes<Entity>;
  omitDetails?: boolean;
};

export function createModelAuditLogger<E extends EntityType>(
  config: AuditLogConfig<E>,
) {
  return {
    async logCreate(
      context: ReqContext | ApiReqContext,
      doc: { id: string; name?: string },
    ) {
      try {
        await context.auditLog({
          entity: {
            object: config.entity,
            id: doc.id,
            name:
              ("name" in doc && typeof doc.name === "string" && doc.name) || "",
          },
          event: config.createEvent,
          details: config.omitDetails ? "" : auditDetailsCreate(doc),
        });
      } catch (e) {
        context.logger.error(
          e,
          `Error creating audit log for ${config.createEvent}`,
        );
      }
    },

    async logUpdate(
      context: ReqContext | ApiReqContext,
      doc: { id: string; name?: string },
      newDoc: { id: string; name?: string },
      overrideEvent?: EventType,
    ) {
      const event = overrideEvent || config.updateEvent;
      try {
        await context.auditLog({
          entity: {
            object: config.entity,
            id: doc.id,
            name:
              ("name" in newDoc &&
                typeof newDoc.name === "string" &&
                newDoc.name) ||
              "",
          },
          event,
          details: config.omitDetails ? "" : auditDetailsUpdate(doc, newDoc),
        });
      } catch (e) {
        context.logger.error(e, `Error creating audit log for ${event}`);
      }
    },

    async logDelete(
      context: ReqContext | ApiReqContext,
      doc: { id: string; name?: string },
    ) {
      try {
        await context.auditLog({
          entity: {
            object: config.entity,
            id: doc.id,
            name:
              ("name" in doc && typeof doc.name === "string" && doc.name) || "",
          },
          event: config.deleteEvent,
          details: config.omitDetails ? "" : auditDetailsDelete(doc),
        });
      } catch (e) {
        context.logger.error(
          e,
          `Error creating audit log for ${config.deleteEvent}`,
        );
      }
    },

    async logAutocreate(
      context: ReqContext | ApiReqContext,
      doc: { id: string; name?: string },
    ) {
      if (!config.autocreateEvent) return;
      try {
        await context.auditLog({
          entity: {
            object: config.entity,
            id: doc.id,
            name:
              ("name" in doc && typeof doc.name === "string" && doc.name) || "",
          },
          event: config.autocreateEvent,
          details: config.omitDetails ? "" : auditDetailsCreate(doc),
        });
      } catch (e) {
        context.logger.error(
          e,
          `Error creating audit log for ${config.autocreateEvent}`,
        );
      }
    },
  };
}
