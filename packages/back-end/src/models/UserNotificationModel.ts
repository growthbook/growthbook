import { omit } from "lodash";
import { Filter, UpdateFilter } from "mongodb";
import {
  UserNotificationInterface,
  userNotificationSchema,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: userNotificationSchema,
  collectionName: "user_notifications",
  idPrefix: "unr_",
  readonlyFields: [],
  additionalIndexes: [
    { fields: { organization: 1, userId: 1, dateCreated: -1 } },
    { fields: { organization: 1, userId: 1, readAt: 1 } },
    { fields: { organization: 1, userId: 1, seenAt: 1 } },
  ],
});

export class UserNotificationModel extends BaseClass {
  protected canCreate(): boolean {
    return false;
  }

  protected canRead(doc: UserNotificationInterface): boolean {
    return doc.userId === this.context.userId;
  }

  protected canUpdate(
    existing: UserNotificationInterface,
    _updates: Partial<UserNotificationInterface>,
  ): boolean {
    return existing.userId === this.context.userId;
  }

  protected canDelete(): boolean {
    return false;
  }

  /**
   * Fan-out from trusted server paths; skips canCreate.
   */
  public async insertManyFromFanOut(
    rows: Omit<
      UserNotificationInterface,
      "id" | "organization" | "dateCreated" | "dateUpdated"
    >[],
  ): Promise<void> {
    if (!rows.length) return;
    const now = new Date();
    const docs = rows.map((row) => {
      const parsed = this.createValidator.parse({
        userId: row.userId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        projectId: row.projectId,
        category: row.category,
        eventType: row.eventType,
        scope: row.scope,
        title: row.title,
        body: row.body,
        payload: row.payload,
        source: row.source,
        seenAt: row.seenAt ?? null,
        readAt: row.readAt ?? null,
        clickedAt: row.clickedAt ?? null,
        dismissedAt: row.dismissedAt ?? null,
      });
      return {
        ...parsed,
        id: this._generateId(),
        organization: this.context.org.id,
        dateCreated: now,
        dateUpdated: now,
      } as UserNotificationInterface;
    });
    await this._dangerousGetCollection().insertMany(docs);
  }

  public async listInboxForCurrentUser(opts: {
    limit: number;
    cursor?: string | null;
    unreadOnly?: boolean;
    unseenOnly?: boolean;
    scope?: "user" | "org" | "project";
  }): Promise<{
    notifications: UserNotificationInterface[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const uid = this.context.userId;
    const filter: Filter<UserNotificationInterface> = {
      organization: this.context.org.id,
      userId: uid,
      dismissedAt: null,
    };
    if (opts.unreadOnly) {
      filter.readAt = null;
    }
    if (opts.unseenOnly) {
      filter.seenAt = null;
    }
    if (opts.scope) {
      filter.scope = opts.scope;
    }

    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (opts.cursor) {
      try {
        const parsed = JSON.parse(
          Buffer.from(opts.cursor, "base64url").toString("utf8"),
        ) as { d: string; id: string };
        cursorDate = new Date(parsed.d);
        cursorId = parsed.id;
      } catch {
        this.context.throwBadRequestError("Invalid cursor");
      }
    }

    const baseFilter: Filter<Record<string, unknown>> = { ...filter };
    const mongoFilter: Filter<Record<string, unknown>> =
      cursorDate && cursorId
        ? {
            $and: [
              baseFilter,
              {
                $or: [
                  { dateCreated: { $lt: cursorDate } },
                  {
                    dateCreated: cursorDate,
                    id: { $lt: cursorId },
                  },
                ],
              },
            ],
          }
        : baseFilter;

    const take = Math.min(Math.max(opts.limit, 1), 100);
    const raw = await this._dangerousGetCollection()
      .find(mongoFilter)
      .sort({ dateCreated: -1, id: -1 })
      .limit(take + 1)
      .toArray();

    const hasMore = raw.length > take;
    const page = hasMore ? raw.slice(0, take) : raw;
    const migrated = page.map((d) =>
      this.migrate(omit(d, ["__v", "_id"])),
    ) as UserNotificationInterface[];

    let nextCursor: string | null = null;
    if (hasMore && migrated.length) {
      const last = migrated[migrated.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          d: last.dateCreated.toISOString(),
          id: last.id,
        }),
        "utf8",
      ).toString("base64url");
    }

    return {
      notifications: migrated,
      hasMore,
      nextCursor,
    };
  }

  public async countForCurrentUser(): Promise<{
    unread: number;
    unseen: number;
  }> {
    const base = {
      organization: this.context.org.id,
      userId: this.context.userId,
    };
    const col = this._dangerousGetCollection();
    const [unread, unseen] = await Promise.all([
      col.countDocuments({
        ...base,
        readAt: null,
        dismissedAt: null,
      }),
      col.countDocuments({
        ...base,
        seenAt: null,
        dismissedAt: null,
      }),
    ]);
    return { unread, unseen };
  }

  public async markSeen(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const now = new Date();
    const res = await this._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        userId: this.context.userId,
        id: { $in: ids },
        seenAt: null,
      } as Filter<Record<string, unknown>>,
      {
        $set: { seenAt: now, dateUpdated: now },
      } as UpdateFilter<Record<string, unknown>>,
    );
    return res.modifiedCount;
  }

  public async markRead(id: string): Promise<void> {
    const now = new Date();
    const res = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        userId: this.context.userId,
        id,
      } as Filter<Record<string, unknown>>,
      {
        $set: { readAt: now, seenAt: now, dateUpdated: now },
      } as UpdateFilter<Record<string, unknown>>,
    );
    if (res.matchedCount === 0) {
      this.context.throwNotFoundError();
    }
  }

  public async markAllRead(): Promise<number> {
    const now = new Date();
    const res = await this._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        userId: this.context.userId,
        readAt: null,
      } as Filter<Record<string, unknown>>,
      {
        $set: { readAt: now, seenAt: now, dateUpdated: now },
      } as UpdateFilter<Record<string, unknown>>,
    );
    return res.modifiedCount;
  }

  public async markDismissed(id: string): Promise<void> {
    const now = new Date();
    const res = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        userId: this.context.userId,
        id,
      } as Filter<Record<string, unknown>>,
      {
        $set: { dismissedAt: now, dateUpdated: now },
      } as UpdateFilter<Record<string, unknown>>,
    );
    if (res.matchedCount === 0) {
      this.context.throwNotFoundError();
    }
  }
}
