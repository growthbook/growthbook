import type { EventLogSummaryItem, EventLogRecord } from "shared/validators";
import type {
  EventLogSummaryQueryResponseRows,
  EventLogRecordsQueryResponseRows,
} from "shared/types/integrations";
import type { ReqContext } from "back-end/types/request";
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  runEventLogSummaryQuery,
  runEventLogRecordsQuery,
} from "back-end/src/services/datasource";
import { filterClientKeysByProject } from "back-end/src/services/session-replay";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";

const MAX_SUMMARY_WINDOW_DAYS = 14;
const MAX_RECORDS_WINDOW_HOURS = 24;

export class EventLogModel {
  protected context: ReqContext;
  private _permittedKeys: Map<string, string[]> | null = null;

  public constructor(context: ReqContext) {
    this.context = context;
  }

  private async getPermittedClientKeys(): Promise<Map<string, string[]>> {
    if (this._permittedKeys) return this._permittedKeys;
    const connections = await findSDKConnectionsByOrganization(this.context);
    this._permittedKeys = new Map(connections.map((c) => [c.key, c.projects]));
    return this._permittedKeys;
  }

  public async listSummary(options: {
    dateFrom: Date;
    dateTo: Date;
    search?: string;
    project?: string;
    limit: number;
    offset: number;
  }): Promise<EventLogSummaryItem[]> {
    if (!this.context.hasPremiumFeature("event-logs")) {
      this.context.throwPlanDoesNotAllowError(
        "Event logs require a Pro or Enterprise plan.",
      );
    }

    const windowMs = options.dateTo.getTime() - options.dateFrom.getTime();
    if (windowMs <= 0) {
      this.context.throwBadRequestError("Date to must be after date from.");
    }
    if (windowMs > MAX_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      this.context.throwBadRequestError(
        `Summary time window cannot exceed ${MAX_SUMMARY_WINDOW_DAYS} days.`,
      );
    }

    const permittedKeys = await this.getPermittedClientKeys();
    if (permittedKeys.size === 0) return [];

    const clientKeys = filterClientKeysByProject(
      permittedKeys,
      options.project,
    );
    if (clientKeys.length === 0) return [];

    const datasource = await getGrowthbookDatasource(this.context);
    if (!datasource) return [];

    const integration = getSourceIntegrationObject(this.context, datasource);
    const { rows } = await runEventLogSummaryQuery(integration, {
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      clientKeys,
      search: options.search,
      limit: options.limit,
      offset: options.offset,
    });

    return aggregateSummaryRows(rows);
  }

  public async listRecords(options: {
    dateFrom: Date;
    dateTo: Date;
    eventName?: string;
    userId?: string;
    environment?: string;
    browser?: string;
    os?: string;
    country?: string;
    sdk?: string;
    project?: string;
    limit: number;
    offset: number;
  }): Promise<EventLogRecord[]> {
    if (!this.context.hasPremiumFeature("event-logs")) {
      this.context.throwPlanDoesNotAllowError(
        "Event logs require a Pro or Enterprise plan.",
      );
    }

    const windowMs = options.dateTo.getTime() - options.dateFrom.getTime();
    if (windowMs <= 0) {
      this.context.throwBadRequestError("Date to must be after date from.");
    }
    if (windowMs > MAX_RECORDS_WINDOW_HOURS * 60 * 60 * 1000) {
      this.context.throwBadRequestError(
        `Records time window cannot exceed ${MAX_RECORDS_WINDOW_HOURS} hours.`,
      );
    }

    const permittedKeys = await this.getPermittedClientKeys();
    if (permittedKeys.size === 0) return [];

    const clientKeys = filterClientKeysByProject(
      permittedKeys,
      options.project,
    );
    if (clientKeys.length === 0) return [];

    const datasource = await getGrowthbookDatasource(this.context);
    if (!datasource) return [];

    const integration = getSourceIntegrationObject(this.context, datasource);
    const { rows } = await runEventLogRecordsQuery(integration, {
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      clientKeys,
      eventName: options.eventName,
      userId: options.userId,
      environment: options.environment,
      browser: options.browser,
      os: options.os,
      country: options.country,
      sdk: options.sdk,
      limit: options.limit,
      offset: options.offset,
    });

    return rows.map(toRecord);
  }
}

/**
 * Aggregates per-(event_name, day) rows into one EventLogSummaryItem per
 * event name with a dailyCounts array sorted by day.
 */
function aggregateSummaryRows(
  rows: EventLogSummaryQueryResponseRows,
): EventLogSummaryItem[] {
  const byEvent = new Map<
    string,
    {
      totalCount: number;
      dauSum: number;
      dayCount: number;
      days: Map<string, number>;
    }
  >();

  for (const row of rows) {
    let entry = byEvent.get(row.event_name);
    if (!entry) {
      entry = { totalCount: 0, dauSum: 0, dayCount: 0, days: new Map() };
      byEvent.set(row.event_name, entry);
    }
    const count = Number(row.day_count) || 0;
    entry.totalCount += count;
    entry.dauSum += Number(row.day_dau) || 0;
    entry.dayCount += 1;
    entry.days.set(row.day, count);
  }

  // Build sorted daily counts and return items ordered by total_count desc
  // (the SQL already orders by total_count desc, so insertion order is correct)
  const items: EventLogSummaryItem[] = [];
  for (const [eventName, entry] of byEvent) {
    const sortedDays = Array.from(entry.days.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    items.push({
      eventName,
      totalCount: entry.totalCount,
      dauCount:
        entry.dayCount > 0 ? Math.round(entry.dauSum / entry.dayCount) : 0,
      dailyCounts: sortedDays.map(([, count]) => count),
    });
  }

  return items;
}

function toRecord(
  row: EventLogRecordsQueryResponseRows[number],
): EventLogRecord {
  return {
    eventUuid: row.event_uuid,
    timestamp: normalizeTimestamp(row.timestamp),
    eventName: row.event_name,
    userId: row.user_id ?? null,
    deviceId: row.device_id ?? null,
    environment: row.environment ?? null,
    properties:
      typeof row.properties === "object" && row.properties !== null
        ? row.properties
        : {},
    attributes:
      typeof row.attributes === "object" && row.attributes !== null
        ? row.attributes
        : {},
    url: row.url ?? null,
    geoCountry: row.geo_country ?? null,
    uaBrowser: row.ua_browser ?? null,
    uaOs: row.ua_os ?? null,
    uaDeviceType: row.ua_device_type ?? null,
    sdkLanguage: row.sdk_language ?? null,
    sdkVersion: row.sdk_version ?? null,
  };
}

function normalizeTimestamp(value: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
