import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { DataExportFileResponse } from "shared/types/data-exports";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getEventsCursorForOrganization } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";
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

  const fileName = `data-export--events--${new Date().getTime()}.json`;

  async function* body() {
    yield `{"fileName":${JSON.stringify(fileName)},"data":"[`;
    let separator = "";
    for await (const event of getEventsCursorForOrganization(org.id)) {
      // `data` is a JSON string, so each event is escaped as a string fragment
      yield JSON.stringify(separator + JSON.stringify(event)).slice(1, -1);
      separator = ",";
    }
    yield `]"}`;
  }

  // Streamed so an org's full audit log is never held in memory at once
  res.type("json");
  await pipeline(Readable.from(body()), res).catch((e) =>
    logger.error(e, "Events data export failed"),
  );
};
