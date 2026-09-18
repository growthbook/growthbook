import { slackUserLinkSchema, SlackUserLinkInterface } from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  SLACK_USER_LINK_COLLECTION,
  linkSlackUser,
  unlinkSlackUser,
} from "back-end/src/services/slack/slackUserLink";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: slackUserLinkSchema,
  collectionName: SLACK_USER_LINK_COLLECTION,
  pKey: ["slackTeamId", "slackUserId"] as const,
  globallyUniquePrimaryKeys: false,
});

export class SlackUserLinkModel extends BaseClass {
  protected canRead(doc: SlackUserLinkInterface) {
    return (
      !!this.context.userId && doc.growthbookUserId === this.context.userId
    );
  }
  protected canCreate() {
    return false;
  }
  protected canUpdate() {
    return false;
  }
  protected canDelete(doc: SlackUserLinkInterface) {
    return this.canRead(doc);
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

  public linkCurrentUser(state: string): Promise<void> {
    return linkSlackUser(this.context, state);
  }

  public unlinkCurrentUser(
    identity: Pick<
      SlackUserLinkInterface,
      "slackTeamId" | "slackUserId" | "linkId"
    >,
  ): Promise<boolean> {
    return unlinkSlackUser(this.context, identity);
  }
}
