import { slackUserLinkSchema, SlackUserLinkInterface } from "shared/validators";
import {
  getCollection,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";
import { parseSlackUserLink } from "back-end/src/services/slack/slackUserLink";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "slackuserlinks";
const BaseClass = MakeModelClass({
  schema: slackUserLinkSchema,
  collectionName: COLLECTION_NAME,
  pKey: ["slackTeamId", "slackUserId"] as const,
  globallyUniquePrimaryKeys: true,
});

export class SlackUserLinkModel extends BaseClass {
  protected canRead(doc: SlackUserLinkInterface) {
    return (
      !!this.context.userId && doc.growthbookUserId === this.context.userId
    );
  }
  // Generic CRUD must not bypass proof of Slack identity ownership.
  protected canCreate() {
    return false;
  }
  protected canUpdate() {
    return false;
  }
  protected canDelete(doc: SlackUserLinkInterface) {
    return this.canRead(doc);
  }

  protected migrate(doc: unknown): SlackUserLinkInterface {
    return parseSlackUserLink(doc);
  }

  // Like API-key authentication, inbound Slack identity lookup precedes org
  // resolution. This lookup grants no access; callers must recheck membership.
  public static async dangerousFindBySlackIdentity(identity: {
    slackTeamId: string;
    slackUserId: string;
  }): Promise<SlackUserLinkInterface | null> {
    const query = slackUserLinkSchema
      .pick({ slackTeamId: true, slackUserId: true })
      .parse(identity);
    const doc = await getCollection(COLLECTION_NAME).findOne(query);
    return doc ? parseSlackUserLink(doc) : null;
  }

  public async linkCurrentUser(state: string): Promise<void> {
    const identity = verifySlackLinkState(state);
    if (
      !identity ||
      !this.context.userId ||
      !this.context.org.members.some(
        (member) => member.id === this.context.userId,
      )
    ) {
      throw new Error(
        "A valid Slack consent link and signed-in account are required.",
      );
    }
    const workspace = await getCollection("slackworkspaceconnections").findOne({
      teamId: identity.slackTeamId,
      organization: this.context.org.id,
    });
    if (!workspace) {
      throw new Error(
        "This Slack workspace is not connected to your organization.",
      );
    }
    const now = new Date();
    const link = slackUserLinkSchema.parse({
      ...identity,
      growthbookUserId: this.context.userId,
      // Audit context only: the identity is shared across connected orgs.
      organization: this.context.org.id,
      dateCreated: now,
      dateUpdated: now,
    });
    // A consented relink may originate in a different org. Keep the global
    // pair unique and derive the replacement account solely from this context.
    const collection = this._dangerousGetCollection();
    // BaseModel starts index creation asynchronously; await the global identity
    // constraint before accepting the first link on a fresh installation.
    await collection.createIndex(
      { slackTeamId: 1, slackUserId: 1 },
      { unique: true },
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await collection.updateOne(
          identity,
          {
            $set: {
              growthbookUserId: link.growthbookUserId,
              organization: link.organization,
              dateUpdated: now,
            },
            $setOnInsert: { dateCreated: now },
            $unset: { organizationId: "" },
          },
          { upsert: true },
        );
        return;
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt === 2) throw error;
      }
    }
  }
}
