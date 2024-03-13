import type { Response } from "express";
import { orgHasPremiumFeature } from "enterprise";
import { getContextFromReq } from "@back-end/src/services/organizations";
import { getLatestEventsForOrganization } from "@back-end/src/models/EventModel";
import { DataExportFileResponse } from "@back-end/types/data-exports";
import { PrivateApiErrorResponse } from "@back-end/types/api";
import { AuthRequest } from "@back-end/src/types/AuthRequest";
import { EventAuditUserForResponseLocals } from "@back-end/src/events/event-types";

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
  req.checkPermissions("viewEvents");

  const { org } = getContextFromReq(req);

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
