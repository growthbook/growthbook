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
 * This intentionally does NOT extend `BaseModel` / `MakeModelClass` because
 * the underlying store is ClickHouse + S3, not MongoDB. The standard
 * BaseModel machinery (audit log on mongo _id, mongoose indexes, write
 * validators) doesn't apply. We do follow the same interface contract
 * BaseModel exposes — context-constructor, canRead/canCreate/canUpdate/
 * canDelete — so callers consume this through `req.context.models.sessionReplays`
 * just like any other model.
 *
 * Sessions are immutable from the customer's perspective: created by the
 * ingest endpoint (which bypasses these permission methods), state-bumped
 * by the idle-timeout sweeper, and finally deleted via DELETE handlers.
 * That's why canCreate/canUpdate return false here.
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
    // Ingestion bypasses this model entirely — sessions are created by the
    // public /api/v1/session-replay/ingest endpoint authenticated by SDK
    // client key, not by an authenticated UI user.
    return false;
  }

  protected canUpdate(): boolean {
    // Sessions are immutable from the user's perspective. The sweeper
    // updates `state` and `lastEventAt` directly (system-level), not
    // through this model.
    return false;
  }

  protected canDelete(
    doc: Pick<SessionReplayInterface, "organization">,
  ): boolean {
    if (doc.organization !== this.context.org.id) return false;
    return this.context.permissions.canDeleteSessionReplay();
  }

  // ---------- Read methods ----------

  /**
   * List recent session-replay metadata for the current org. Filtering and
   * pagination are implemented in ClickHouse query options. Results are
   * permission-filtered before returning.
   */
  public async list(options?: {
    userId?: string;
    clientKey?: string;
    state?: "recording" | "finalized" | "deleted";
    url?: string;
    limit?: number;
    offset?: number;
  }): Promise<SessionReplayInterface[]> {
    const rows = await listSessionReplays(this.context.org.id, options);
    return rows
      .map((row) => this.toInterface(row))
      .filter((doc) => this.canRead(doc));
  }

  /**
   * Look up a single session by its session_id. Returns null if not found
   * OR if the caller lacks permission — we deliberately don't distinguish
   * between "not found" and "no permission" to avoid leaking existence.
   */
  public async getBySessionId(
    sessionId: string,
  ): Promise<SessionReplayInterface | null> {
    const row = await getSessionReplayBySessionId(
      this.context.org.id,
      sessionId,
    );
    if (!row) return null;
    const doc = this.toInterface(row);
    if (!this.canRead(doc)) return null;
    return doc;
  }

  /**
   * Fetch the rrweb event stream for a session. Today this concatenates
   * all chunks server-side; #12 will replace this with pre-signed S3 URLs
   * served to the browser. Permission is enforced via getBySessionId
   * before this is called by callers — this method itself trusts that.
   */
  public async getEventsForStoragePrefix(
    storagePrefix: string,
  ): Promise<SessionReplayRrwebEvent[]> {
    // Cast through unknown — the underlying loader currently returns
    // unknown[] (rrweb event shape isn't validated server-side). The Zod
    // schema in shared loosely validates {type, timestamp, data} for
    // ingest, but stored events are read back without re-validation.
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
   *
   * The `id` / `organization` / `dateCreated` / `dateUpdated` fields come
   * from the BaseModel-shape required by the validator; we synthesize them
   * from the ClickHouse columns to match.
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
      storagePrefix: row.s3_key,
      startedAt,
      endedAt,
      lastEventAt,
      durationMs: row.duration_ms,
      eventCount: row.event_count,
      urlFirst: row.url_first,
      urlsVisited: row.urls_visited,
      attributes: row.attributes,
      experiments: row.experiments,
      flags: row.flags,
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
