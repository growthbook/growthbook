import {
  slackAssistantThreadSchema,
  SlackAssistantThreadInterface,
  SlackThreadIdentity,
} from "shared/validators";
import {
  ensureIndexOnce,
  getCollection,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { slackTaskKey } from "back-end/src/services/slack/slackTaskSafety";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "slackassistantthreads";
const NOTIFICATION_BINDING_MS = 90 * 24 * 60 * 60 * 1000;

const BaseClass = MakeModelClass({
  schema: slackAssistantThreadSchema,
  collectionName: COLLECTION_NAME,
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [{ fields: { expiresAt: 1 }, expireAfterSeconds: 0 }],
});

const bindingId = ({ teamId, channelId, rootTs }: SlackThreadIdentity) =>
  slackTaskKey([teamId, channelId, rootTs]);

/**
 * Binds a Slack thread to the organization its messages are handled in, so
 * replies keep routing there even after the workspace is disconnected and
 * reconnected to another organization. The first writer wins and a binding is
 * never repointed. A binding a notification created expires after 90 days
 * unless someone converses in the thread, which makes it permanent.
 */
export class SlackAssistantThreadModel extends BaseClass {
  // Read before the organization is known: the binding is how it is found.
  public static async dangerousGetForThread(
    identity: SlackThreadIdentity,
  ): Promise<SlackAssistantThreadInterface | null> {
    const doc = await getCollection(COLLECTION_NAME).findOne({
      id: bindingId(identity),
    });
    return doc ? slackAssistantThreadSchema.strip().parse(doc) : null;
  }

  // Internal routing state available to every org context; callers authorize the action.
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return false;
  }

  protected async beforeCreate() {
    // First-writer-wins only holds once the unique index exists.
    await ensureIndexOnce(
      this._dangerousGetCollection(),
      { id: 1 },
      { unique: true },
    );
  }

  /** A notification's thread keeps routing to the sending organization for 90 days. */
  public async bindNotificationThread(
    identity: SlackThreadIdentity,
  ): Promise<void> {
    await this.bind(identity, {
      expiresAt: new Date(Date.now() + NOTIFICATION_BINDING_MS),
    });
  }

  /**
   * A thread someone converses in is bound for good. Returns the binding that
   * holds, which may belong to another organization.
   */
  public async bindConversationThread(
    identity: SlackThreadIdentity,
  ): Promise<SlackAssistantThreadInterface> {
    const thread = await this.bind(identity, {});
    if (thread.organization === this.context.org.id && thread.expiresAt) {
      return this._updateOne(thread, { expiresAt: undefined });
    }
    return thread;
  }

  private async bind(
    identity: SlackThreadIdentity,
    fields: { expiresAt?: Date },
  ): Promise<SlackAssistantThreadInterface> {
    try {
      return await this._createOne({
        id: bindingId(identity),
        ...identity,
        ...fields,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    const existing =
      await SlackAssistantThreadModel.dangerousGetForThread(identity);
    if (!existing) {
      throw new Error("Could not save the Slack thread's organization.");
    }
    return existing;
  }
}
