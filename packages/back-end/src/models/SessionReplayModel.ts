import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  getSessionReplayChunksBySessionId,
  listSessionReplays,
  SessionReplayRow,
} from "back-end/src/services/clickhouse";
import {
  filterClientKeysByProject,
  getSessionReplayEventsByStoragePrefix,
} from "back-end/src/services/session-replay";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";

/**
 * Internal API model for Session Replay metadata.
 *
 * Sessions are immutable from the customer's perspective: canCreate/canUpdate return false here.
 */
export class SessionReplayModel {
  protected context: ReqContext;
  private _permittedKeys: Map<string, string[]> | null = null;

  public constructor(context: ReqContext) {
    this.context = context;
  }

  // ---------- Permission helpers ----------

  /**
   * Builds a map of clientKey → projects from the SDK connections the current
   * user is allowed to read. Memoized per request (model instance is per-request).
   */
  private async getPermittedClientKeys(): Promise<Map<string, string[]>> {
    if (this._permittedKeys) return this._permittedKeys;
    const connections = await findSDKConnectionsByOrganization(this.context);
    this._permittedKeys = new Map(connections.map((c) => [c.key, c.projects]));
    return this._permittedKeys;
  }

  protected canRead(
    doc: Pick<SessionReplayInterface, "organization">,
    projects: string[],
  ): boolean {
    if (doc.organization !== this.context.org.id) return false;
    return this.context.permissions.canViewSessionReplay({ projects });
  }

  protected canCreate(): boolean {
    return false;
  }

  protected canUpdate(): boolean {
    return false;
  }

  protected canDelete(
    doc: Pick<SessionReplayInterface, "organization">,
    projects: string[],
  ): boolean {
    if (doc.organization !== this.context.org.id) return false;
    return this.context.permissions.canDeleteSessionReplay({ projects });
  }

  // ---------- Read methods ----------

  public async list(options?: {
    userId?: string;
    clientKey?: string;
    url?: string;
    country?: string;
    device?: string;
    minDurationSecs?: number;
    maxDurationSecs?: number;
    minEventCount?: number;
    maxEventCount?: number;
    featureKey?: string;
    experimentKey?: string;
    project?: string;
    limit?: number;
    offset?: number;
  }): Promise<SessionReplayInterface[]> {
    const permittedKeys = await this.getPermittedClientKeys();
    if (permittedKeys.size === 0) return [];

    const clientKeys = filterClientKeysByProject(
      permittedKeys,
      options?.project,
    );
    if (clientKeys.length === 0) return [];

    const rows = await listSessionReplays(this.context, {
      ...options,
      clientKeys,
    });
    return rows.map((row) => this.toInterface(row));
  }

  public async getBySessionId(
    sessionId: string,
  ): Promise<SessionReplayInterface | null> {
    const chunks = await getSessionReplayChunksBySessionId(
      this.context,
      sessionId,
    );
    if (!chunks.length) return null;
    const doc = this.mergeChunks(chunks);

    const permittedKeys = await this.getPermittedClientKeys();
    const projects = permittedKeys.get(doc.clientKey);
    // clientKey not in permitted set — orphaned or no access
    if (projects === undefined) return null;
    if (!this.canRead(doc, projects)) return null;

    return doc;
  }

  public async getEventsForS3Key(
    s3Key: string,
  ): Promise<SessionReplayRrwebEvent[]> {
    // s3Key is the full object key (e.g. .../uuid/0.json.gz); strip the
    // chunk filename so the S3 listing finds all chunks for the session.
    const prefix = s3Key.substring(0, s3Key.lastIndexOf("/") + 1);
    const events = (await getSessionReplayEventsByStoragePrefix(
      prefix,
    )) as unknown as SessionReplayRrwebEvent[];
    return events;
  }

  // ---------- Translation: ClickHouse rows → domain interface ----------

  /**
   * Aggregate all chunk rows for a session into a single interface object.
   * Scalars use first-row / max / sum as appropriate; arrays are
   * union-deduped; JSON eval items are concatenated across chunks.
   */
  private mergeChunks(chunks: SessionReplayRow[]): SessionReplayInterface {
    const base = this.toInterface(chunks[0]);
    if (chunks.length === 1) return base;

    for (let i = 1; i < chunks.length; i++) {
      const row = chunks[i];
      const endedAt = parseClickHouseDate(row.ended_at);
      const lastEventAt = parseClickHouseDate(row.last_event_at);

      if (endedAt > base.endedAt) base.endedAt = endedAt;
      if (lastEventAt > base.lastEventAt) {
        base.lastEventAt = lastEventAt;
        base.dateUpdated = lastEventAt;
      }
      if (row.duration_ms > base.durationMs) base.durationMs = row.duration_ms;
      base.eventCount += row.event_count;
      base.errorCount += row.error_count;

      for (const url of row.urls_visited ?? []) {
        if (!base.urlsVisited.includes(url)) base.urlsVisited.push(url);
      }
      for (const k of row.feature_keys ?? []) {
        if (!base.featureKeys.includes(k)) base.featureKeys.push(k);
      }
      for (const k of row.experiment_keys ?? []) {
        if (!base.experimentKeys.includes(k)) base.experimentKeys.push(k);
      }

      base.featureEvals?.items.push(...(row.feature_evals?.items ?? []));
      base.experimentEvals?.items.push(...(row.experiment_evals?.items ?? []));
      base.sessionEvents?.items.push(...(row.session_events?.items ?? []));
    }

    return base;
  }

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
      id: row.session_replay_id,
      organization: row.organization,
      dateCreated: createdAt,
      dateUpdated: lastEventAt,
      clientKey: row.client_key,
      userId: row.user_id,
      deviceId: row.device_id ?? "",
      s3Key: row.s3_key,
      startedAt,
      endedAt,
      lastEventAt,
      durationMs: row.duration_ms,
      eventCount: row.event_count,
      errorCount: row.error_count,
      urlFirst: row.url_first,
      urlsVisited: row.urls_visited ?? [],
      pageTitle: row.page_title ?? "",
      viewportWidth: row.viewport_width ?? 0,
      viewportHeight: row.viewport_height ?? 0,
      attributes: row.attributes ?? {},
      featureKeys: row.feature_keys ?? [],
      experimentKeys: row.experiment_keys ?? [],
      featureEvals: { items: row.feature_evals?.items ?? [] },
      experimentEvals: { items: row.experiment_evals?.items ?? [] },
      sessionEvents: { items: row.session_events?.items ?? [] },
      userAgent: row.user_agent,
      country: row.country ?? "",
      device: row.device ?? "",
      browser: row.browser ?? "",
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
