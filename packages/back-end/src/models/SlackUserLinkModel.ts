import { slackUserLinkSchema, SlackUserLinkInterface } from "shared/validators";
import {
  getCollection,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";
import {
  claimSlackTask,
  slackTaskKey,
} from "back-end/src/services/slack/slackTaskSafety";
import { SlackWorkspaceConnectionModel } from "./SlackWorkspaceConnectionModel";
import { MakeModelClass } from "./BaseModel";

const SLACK_USER_LINK_COLLECTION = "slackuserlinks";

const BaseClass = MakeModelClass({
  schema: slackUserLinkSchema,
  collectionName: SLACK_USER_LINK_COLLECTION,
  pKey: ["slackTeamId", "slackUserId"] as const,
  globallyUniquePrimaryKeys: false,
});

export class SlackUserLinkModel extends BaseClass {
  protected canRead() {
    return !!this.context.userId;
  }
  protected canCreate(doc: SlackUserLinkInterface) {
    return (
      !!this.context.userId && doc.growthbookUserId === this.context.userId
    );
  }
  protected canUpdate(
    existing: SlackUserLinkInterface,
    updates: Partial<SlackUserLinkInterface>,
  ) {
    return (
      !!this.context.userId &&
      (updates.growthbookUserId ?? existing.growthbookUserId) ===
        this.context.userId
    );
  }
  protected canDelete(doc: SlackUserLinkInterface) {
    return (
      !!this.context.userId && doc.growthbookUserId === this.context.userId
    );
  }

  // Authentication lookup only. Each returned link still requires a current membership check.
  public static async dangerousFindAllBySlackIdentity(identity: {
    slackTeamId: string;
    slackUserId: string;
  }): Promise<SlackUserLinkInterface[]> {
    const query = slackUserLinkSchema
      .pick({ slackTeamId: true, slackUserId: true })
      .parse(identity);
    const docs = await getCollection(SLACK_USER_LINK_COLLECTION)
      .find(query)
      .toArray();
    return docs.map((doc) => slackUserLinkSchema.strip().parse(doc));
  }

  public async getCurrentUserLinks(): Promise<SlackUserLinkInterface[]> {
    if (!this.context.userId) return [];
    return this._find({ growthbookUserId: this.context.userId });
  }

  public async linkCurrentUser(state: string): Promise<void> {
    const proof = verifySlackLinkState(state);
    const { userId, org } = this.context;
    if (
      !proof ||
      !userId ||
      !org.members.some((member) => member.id === userId)
    ) {
      throw new Error(
        "A valid Slack consent link and signed-in account are required.",
      );
    }
    const workspace = await SlackWorkspaceConnectionModel.dangerousGetForTeam(
      proof.slackTeamId,
    );
    if (!workspace || workspace.organization !== org.id) {
      throw new Error(
        "This Slack workspace is not connected to your organization.",
      );
    }
    const identity = {
      slackTeamId: proof.slackTeamId,
      slackUserId: proof.slackUserId,
    };
    const linkId = slackTaskKey([proof.nonce, org.id]);
    if (!(await claimSlackTask(`link:${linkId}`))) {
      const current = await this._findOne({
        ...identity,
        growthbookUserId: userId,
        linkId,
      });
      if (current) return;
      throw new Error(
        "This consent link has already been used for this organization. Send 'link account' to GrowthBook in Slack for a fresh link.",
      );
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this._findOne(identity);
      if (existing) {
        await this._updateOne(existing, { growthbookUserId: userId, linkId });
        return;
      }
      try {
        await this._createOne({
          ...identity,
          growthbookUserId: userId,
          linkId,
        });
        return;
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt === 2) throw error;
      }
    }
  }

  public async unlinkCurrentUser(
    identity: Pick<
      SlackUserLinkInterface,
      "slackTeamId" | "slackUserId" | "linkId"
    >,
  ): Promise<boolean> {
    if (!this.context.userId) {
      throw new Error(
        "You must be signed in to disconnect your Slack account.",
      );
    }
    const current = await this._findOne({
      slackTeamId: identity.slackTeamId,
      slackUserId: identity.slackUserId,
    });
    if (
      !current ||
      current.growthbookUserId !== this.context.userId ||
      current.linkId !== identity.linkId
    )
      return false;
    // A replacement between this read and delete can still be removed; BaseModel deletes by primary key.
    await this._deleteOne(current);
    return true;
  }
}
