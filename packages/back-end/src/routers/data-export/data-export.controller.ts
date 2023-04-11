import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { getLatestEventsForOrganization } from "../../models/EventModel";
import { DataExportFileResponse } from "../../../types/data-exports";
import { orgHasPremiumFeature } from "../../util/organization.util";

/**
 * GET /data-export/events
 * Get one data-export resource by ID
 * @param req
 * @param res
 */
export const getDataExportForEvents = async (
  req: AuthRequest,
  res: Response<
    DataExportFileResponse | ApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  req.checkPermissions("viewEvents");

  const { org } = getOrgFromReq(req);

  if (!orgHasPremiumFeature(org, "audit-logging")) {
    return res.status(403).json({
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
