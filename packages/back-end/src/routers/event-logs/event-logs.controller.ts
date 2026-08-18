import type { Response } from "express";
import type { EventLogSummaryItem, EventLogRecord } from "shared/validators";
import { parseIntWithDefaultCapped } from "shared/util";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

type SummaryResponse = { items: EventLogSummaryItem[] };
type RecordsResponse = { records: EventLogRecord[] };

export async function listSummary(
  req: AuthRequest<
    unknown,
    unknown,
    {
      dateFrom: string;
      dateTo: string;
      search?: string;
      project?: string;
      page?: string;
    }
  >,
  res: Response<SummaryResponse>,
) {
  const context = getContextFromReq(req);
  const page = parseIntWithDefaultCapped(req.query.page, 1, 1_000);
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  const items = await context.models.eventLogs.listSummary({
    dateFrom: new Date(req.query.dateFrom),
    dateTo: new Date(req.query.dateTo),
    search: req.query.search,
    project: req.query.project,
    limit: pageSize,
    offset,
  });

  res.status(200).json({ items });
}

export async function listRecords(
  req: AuthRequest<
    unknown,
    unknown,
    {
      dateFrom: string;
      dateTo: string;
      eventName?: string;
      userId?: string;
      environment?: string;
      browser?: string;
      os?: string;
      country?: string;
      sdk?: string;
      project?: string;
      page?: string;
    }
  >,
  res: Response<RecordsResponse>,
) {
  const context = getContextFromReq(req);
  const page = parseIntWithDefaultCapped(req.query.page, 1, 1_000);
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  const records = await context.models.eventLogs.listRecords({
    dateFrom: new Date(req.query.dateFrom),
    dateTo: new Date(req.query.dateTo),
    eventName: req.query.eventName,
    userId: req.query.userId,
    environment: req.query.environment,
    browser: req.query.browser,
    os: req.query.os,
    country: req.query.country,
    sdk: req.query.sdk,
    project: req.query.project,
    limit: pageSize,
    offset,
  });

  res.status(200).json({ records });
}
