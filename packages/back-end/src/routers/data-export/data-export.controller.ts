import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { getLatestEventsForOrganization } from "../../models/EventModel";

// region GET /data-export/:id

type GetDataExportResponse = {
  fileName: string;
  data: string;
};

/**
 * GET /data-export/:id
 * Get one data-export resource by ID
 * @param req
 * @param res
 */
export const getDataExport = async (
  req: AuthRequest,
  res: Response<
    GetDataExportResponse | ApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  req.checkPermissions("viewEvents");

  const { org } = getOrgFromReq(req);

  const events = await getLatestEventsForOrganization(org.id, 0);

  const fileName = `data-export--events--${new Date().getTime()}.json`;

  return res.json({
    fileName,
    data: JSON.stringify(events),
  });
};

// endregion GET /data-export/:id
