import {
  NotificationPreferencesInterface,
  notificationPreferencesSchema,
  NotificationPreferencesPatch,
  notificationPreferencesPatchSchema,
  categoryChannelPrefsSchema,
  notificationCategorySchema,
} from "shared/validators";
import { z } from "zod";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: notificationPreferencesSchema,
  pKey: ["userId", "organization"],
  collectionName: "notification_preferences",
  idPrefix: "npref_",
  readonlyFields: [],
  additionalIndexes: [{ fields: { organization: 1, userId: 1 }, unique: true }],
});

const DEFAULT_CATEGORIES: Record<
  z.infer<typeof notificationCategorySchema>,
  z.infer<typeof categoryChannelPrefsSchema>
> = {
  CHANGE: { inApp: true },
  MENTION: { inApp: true },
  REVIEW: { inApp: true },
  SYSTEM: { inApp: true },
  MARKETING: { inApp: false },
  INTEGRATION: { inApp: true },
};

export class NotificationPreferencesModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.userId !== "";
  }

  protected canRead(doc: NotificationPreferencesInterface): boolean {
    return doc.userId === this.context.userId;
  }

  protected canUpdate(): boolean {
    return true;
  }

  protected canDelete(): boolean {
    return false;
  }

  private mergeWithDefaults(
    partial?: NotificationPreferencesInterface["categories"],
  ): NonNullable<NotificationPreferencesInterface["categories"]> {
    const out = { ...DEFAULT_CATEGORIES };
    if (partial) {
      for (const k of Object.keys(partial) as Array<
        keyof typeof DEFAULT_CATEGORIES
      >) {
        out[k] = { ...out[k], ...partial[k] };
      }
    }
    return out;
  }

  public async getOrCreateForCurrentUser(): Promise<NotificationPreferencesInterface> {
    const existing = await this._findOne({
      userId: this.context.userId,
    });
    if (existing) {
      return {
        ...existing,
        categories: this.mergeWithDefaults(existing.categories),
      };
    }
    return await this._createOne({
      userId: this.context.userId,
      categories: DEFAULT_CATEGORIES,
      digestFrequency: "instant",
    });
  }

  public async getByUserIds(
    userIds: string[],
  ): Promise<Map<string, NotificationPreferencesInterface | null>> {
    const m = new Map<string, NotificationPreferencesInterface | null>();
    if (!userIds.length) return m;
    for (const uid of userIds) m.set(uid, null);
    const docs = await this._find(
      { userId: { $in: userIds } },
      { bypassReadPermissionChecks: true },
    );
    for (const d of docs) {
      m.set(d.userId, d);
    }
    return m;
  }

  public async patchForCurrentUser(
    patch: NotificationPreferencesPatch,
  ): Promise<NotificationPreferencesInterface> {
    const parsed = notificationPreferencesPatchSchema.parse(patch);
    const existing = await this.getOrCreateForCurrentUser();
    const nextCategories = this.mergeWithDefaults(existing.categories);
    if (parsed.categories) {
      for (const [cat, ch] of Object.entries(parsed.categories)) {
        const key = cat as keyof typeof nextCategories;
        nextCategories[key] = { ...nextCategories[key], ...ch };
      }
    }
    const updates: Partial<NotificationPreferencesInterface> = {
      categories: nextCategories,
    };
    if (parsed.digestFrequency !== undefined) {
      updates.digestFrequency = parsed.digestFrequency;
    }
    return await this._updateOne(existing, updates);
  }

  public isCategoryInAppEnabled(
    category: z.infer<typeof notificationCategorySchema>,
    doc: NotificationPreferencesInterface | null,
  ): boolean {
    const cats = this.mergeWithDefaults(doc?.categories);
    return cats[category]?.inApp !== false;
  }
}
