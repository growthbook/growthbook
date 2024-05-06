import type { Response } from "express";
import { orgHasPremiumFeature } from "enterprise";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { getLatestEventsForOrganization } from "../../models/EventModel";
import { DataExportFileResponse } from "../../../types/data-exports";
import { PrivateApiErrorResponse } from "../../../types/api";

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
    EventAuditUserForResponseLocals
  >
) => {
  const context = getContextFromReq(req);
  const { org } = context;

  if (!context.permissions.canViewEvents()) {
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
