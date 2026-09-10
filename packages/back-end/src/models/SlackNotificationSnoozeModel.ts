import { slackNotificationSnoozeValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: slackNotificationSnoozeValidator,
  // Matches the collection the previous Mongoose model wrote to.
  collectionName: "slacknotificationsnoozes",
  idPrefix: "slacksnooze_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { eventWebHookId: 1, experimentId: 1 },
      name: "snooze_webhook_experiment",
    },
  ],
});

/**
 * Snoozes are a delivery preference for a connected channel, not user data:
 * anyone who can act on a notification in that channel can mute it, and the
 * inbound Slack handler already authorizes the clicking user (linked account,
 * org membership, and read access to the experiment) before writing one.
 */
export class SlackNotificationSnoozeModel extends BaseClass {
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
    return true;
  }

  /** Mute one experiment's notifications in one channel until `snoozedUntil`. */
  public async snoozeExperiment({
    eventWebHookId,
    experimentId,
    snoozedUntil,
  }: {
    eventWebHookId: string;
    experimentId: string;
    snoozedUntil: Date;
  }): Promise<void> {
    const existing = await this._findOne({ eventWebHookId, experimentId });
    if (existing) {
      await this.update(existing, { snoozedUntil });
      return;
    }
    await this.create({ eventWebHookId, experimentId, snoozedUntil });
  }

  /** Whether this experiment is currently muted for this channel. */
  public async isExperimentSnoozed({
    eventWebHookId,
    experimentId,
  }: {
    eventWebHookId: string;
    experimentId: string;
  }): Promise<boolean> {
    const snooze = await this._findOne({
      eventWebHookId,
      experimentId,
      snoozedUntil: { $gt: new Date() },
    });
    return !!snooze;
  }
}
