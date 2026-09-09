import {
  SlackWorkspaceConnectionInterface,
  slackWorkspaceConnectionSchema,
} from "shared/validators";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: slackWorkspaceConnectionSchema,
  collectionName: "slackworkspaceconnections",
  pKey: ["teamId"] as const,
  readonlyFields: [],
});

type SlackWorkspaceConnectionFields = Omit<
  SlackWorkspaceConnectionInterface,
  "organization" | "teamId" | "dateCreated" | "dateUpdated"
>;

export class SlackWorkspaceConnectionModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.permissions.canManageIntegrations();
  }

  protected canRead(): boolean {
    return this.context.permissions.canManageIntegrations();
  }

  protected canUpdate(): boolean {
    return this.context.permissions.canManageIntegrations();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canManageIntegrations();
  }

  public getByTeamId(
    teamId: string,
  ): Promise<SlackWorkspaceConnectionInterface | null> {
    return this._findOne({ teamId });
  }

  public async upsertForTeam(
    teamId: string,
    fields: SlackWorkspaceConnectionFields,
  ): Promise<SlackWorkspaceConnectionInterface> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.getByTeamId(teamId);
      if (existing) {
        return this._updateOne(existing, fields);
      }

      try {
        return await this._createOne({ teamId, ...fields });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }

    throw new Error(
      "Could not save the Slack workspace because it is being connected concurrently.",
    );
  }

  public async deleteForTeam(teamId: string): Promise<boolean> {
    const existing = await this.getByTeamId(teamId);
    if (!existing) return false;
    await this._deleteOne(existing);
    return true;
  }
}
