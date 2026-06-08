import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  getSessionReplayBySessionId,
  listSessionReplays,
  SessionReplayRow,
} from "back-end/src/services/clickhouse";
import { getSessionReplayEventsByStoragePrefix } from "back-end/src/services/session-replay";

/**
 * Internal API model for Session Replay metadata.
 *
 * Sessions are immutable from the customer's perspective: canCreate/canUpdate return false here.
 */
export class SessionReplayModel {
  protected context: ReqContext;

  public constructor(context: ReqContext) {
    this.context = context;
  }

  // ---------- Permission methods ----------

  protected canRead(
    doc: Pick<SessionReplayInterface, "organization">,
  ): boolean {
    if (doc.organization !== this.context.org.id) return false;
    return this.context.permissions.canViewSessionReplay();
  }

  protected canCreate(): boolean {
    return false;
  }

  protected canUpdate(): boolean {
    return false;
  }

  protected canDelete(
    doc: Pick<SessionReplayInterface, "organization">,
  ): boolean {
    if (doc.organization !== this.context.org.id) return false;
    return this.context.permissions.canDeleteSessionReplay();
  }

  // ---------- Read methods ----------

  public async list(options?: {
    userId?: string;
    clientKey?: string;
    state?: "recording" | "finalized" | "deleted";
    url?: string;
    country?: string;
    device?: string;
    minDurationSecs?: number;
    maxDurationSecs?: number;
    minEventCount?: number;
    maxEventCount?: number;
    featureKey?: string;
    experimentKey?: string;
    limit?: number;
    offset?: number;
  }): Promise<SessionReplayInterface[]> {
    const rows = await listSessionReplays(this.context, options);
    return rows
      .map((row) => this.toInterface(row))
      .filter((doc) => this.canRead(doc));
  }

  public async getBySessionId(
    sessionId: string,
  ): Promise<SessionReplayInterface | null> {
    const row = await getSessionReplayBySessionId(this.context, sessionId);
    if (!row) return null;
    const doc = this.toInterface(row);
    if (!this.canRead(doc)) return null;
    return doc;
  }

  public async getEventsForStoragePrefix(
    storagePrefix: string,
  ): Promise<SessionReplayRrwebEvent[]> {
    const events = (await getSessionReplayEventsByStoragePrefix(
      storagePrefix,
    )) as unknown as SessionReplayRrwebEvent[];
    return events;
  }

  // ---------- Translation: ClickHouse row → domain interface ----------

  /**
   * The ClickHouse table uses snake_case column names. The
   * `SessionReplayInterface` validator in `shared` uses camelCase. This
   * translates one to the other so the rest of the back-end and the
   * front-end can work in domain-shaped objects.
   */
  private toInterface(row: SessionReplayRow): SessionReplayInterface {
    const startedAt = parseClickHouseDate(row.started_at);
    const endedAt = parseClickHouseDate(row.ended_at);
    const lastEventAt = parseClickHouseDate(row.last_event_at);
    const createdAt = parseClickHouseDate(row.created_at);

    return {
      id: row.session_id,
      organization: row.org_id,
      dateCreated: createdAt,
      dateUpdated: lastEventAt,
      sessionId: row.session_id,
      clientKey: row.client_key,
      userId: row.user_id,
      deviceId: row.device_id ?? "",
      storagePrefix: row.s3_key,
      startedAt,
      endedAt,
      lastEventAt,
      durationMs: row.duration_ms,
      eventCount: row.event_count,
      urlFirst: row.url_first,
      urlsVisited: row.urls_visited,
      pageTitle: row.page_title ?? "",
      viewportWidth: row.viewport_width ?? 0,
      viewportHeight: row.viewport_height ?? 0,
      utmSource: row.utm_source ?? "",
      utmMedium: row.utm_medium ?? "",
      utmCampaign: row.utm_campaign ?? "",
      utmTerm: row.utm_term ?? "",
      utmContent: row.utm_content ?? "",
      attributes: row.attributes ?? {},
      featureEvals: row.feature_evals ?? { items: [] },
      experimentEvals: row.experiment_evals ?? { items: [] },
      sessionEvents: row.session_events ?? { items: [] },
      userAgent: row.user_agent,
      state: row.state,
    };
  }
}

/**
 * ClickHouse returns DateTime64(3) columns as strings like
 * "2026-04-29 17:42:11.123" (no timezone). Treat them as UTC.
 */
function parseClickHouseDate(value: string): Date {
  if (!value) return new Date(0);
  // Already-ISO strings (with T) are passed through; bare-space strings get
  // a Z appended so JS parses them as UTC instead of local time.
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    logger.warn({ value }, "session-replay: failed to parse ClickHouse date");
    return new Date(0);
  }
  return d;
}
