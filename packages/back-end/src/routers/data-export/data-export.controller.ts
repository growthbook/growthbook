import type { Response } from "express";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { DataExportFileResponse } from "shared/types/data-exports";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getLatestEventsForOrganization } from "back-end/src/models/EventModel";
import { PrivateApiErrorResponse } from "back-end/types/api";

/**
 * GET /data-export/events
 * Get one data-export resource by ID
 * @param req
 * @param res
 */
export const getDataExportForEvents = async (
  req: AuthRequest,
  res: Response<
    DataExportFileResponse | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);
  const { org } = context;

  if (!context.permissions.canViewAuditLogs()) {
    context.permissions.throwPermissionError();
  }

  if (!orgHasPremiumFeature(org, "audit-logging")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: audit-logging",
    });
  }

  const events = await getLatestEventsForOrganization(org.id, 0);

  const fileName = `data-export--events--${new Date().getTime()}.json`;

  return res.json({
    fileName,
    data: JSON.stringify(events),
  });
};
