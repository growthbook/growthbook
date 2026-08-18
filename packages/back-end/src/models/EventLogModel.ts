import type { EventLogSummaryItem, EventLogRecord } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import {
  listEventLogSummary,
  listEventLogRecords,
  EventLogSummaryRow,
  EventLogRecordRow,
} from "back-end/src/services/clickhouse";
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

    const rows = await listEventLogSummary(this.context, {
      dateFrom: options.dateFrom.toISOString(),
      dateTo: options.dateTo.toISOString(),
      clientKeys,
      search: options.search,
      limit: options.limit,
      offset: options.offset,
    });

    return rows.map(toSummaryItem);
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

    const rows = await listEventLogRecords(this.context, {
      dateFrom: options.dateFrom.toISOString(),
      dateTo: options.dateTo.toISOString(),
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

function toSummaryItem(row: EventLogSummaryRow): EventLogSummaryItem {
  return {
    eventName: row.event_name,
    totalCount: Number(row.total_count),
    dauCount: Math.round(Number(row.dau_count)),
    dailyCounts: (row.daily_counts ?? []).map(Number),
  };
}

function toRecord(row: EventLogRecordRow): EventLogRecord {
  return {
    eventUuid: row.event_uuid,
    timestamp: normalizeClickHouseTimestamp(row.timestamp),
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

function normalizeClickHouseTimestamp(value: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
