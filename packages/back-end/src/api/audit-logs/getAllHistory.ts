import { GetAllHistoryResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getAllHistoryValidator } from "back-end/src/validators/openapi";
import {
  findAllAuditsAndChildrenByEntityType,
  toApiAuditLog,
} from "back-end/src/models/AuditModel";
import { isValidAuditEntityType } from "back-end/src/services/audit";
import { EntityType } from "back-end/src/types/Audit";

export const getAllHistory = createApiRequestHandler(getAllHistoryValidator)(
  async (req): Promise<GetAllHistoryResponse> => {
    const { org } = req.context;
    const { type } = req.params;

    if (!isValidAuditEntityType(type)) {
      throw new Error(
        `${type} is not a valid entity type. Possible entity types are: ${EntityType}`
      );
    }

    const rawEvents = await findAllAuditsAndChildrenByEntityType(org.id, type);

    if (rawEvents.find((e) => e.organization !== org.id)) {
      req.context.permissions.throwPermissionError();
    }

    const auditEvents = rawEvents.map(toApiAuditLog);

    return {
      events: auditEvents,
    };
  }
);
