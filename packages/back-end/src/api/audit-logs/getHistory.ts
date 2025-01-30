import { GetHistoryResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getHistoryValidator } from "back-end/src/validators/openapi";
import {
  findAuditAndChildrenByEntity,
  toApiAuditLog,
} from "back-end/src/models/AuditModel";
import { isValidAuditEntityType } from "back-end/src/services/audit";
import { EntityType } from "back-end/src/types/Audit";

export const getHistory = createApiRequestHandler(getHistoryValidator)(
  async (req): Promise<GetHistoryResponse> => {
    const { org } = req.context;
    const { type, id } = req.params;

    if (!isValidAuditEntityType(type)) {
      throw new Error(
        `${type} is not a valid entity type. Possible entity types are: ${EntityType}`
      );
    }

    const rawEvents = await findAuditAndChildrenByEntity(org.id, type, id);

    if (rawEvents.find((e) => e.organization !== org.id)) {
      req.context.permissions.throwPermissionError();
    }

    const auditEvents = rawEvents.map(toApiAuditLog);

    return {
      events: auditEvents,
    };
  }
);
