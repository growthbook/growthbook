import {
  SlackWorkspaceConnectionInterface,
  slackWorkspaceConnectionSchema,
} from "shared/validators";
import {
  getCollection,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

// Keep the org-scoped primary key; these removable indexes impose today's 1:1 policy.
const connectionIndexes: {
  fields: { teamId: 1 } | { organization: 1 };
  unique: true;
  name: string;
}[] = [
  {
    fields: { teamId: 1 },
    unique: true,
    name: "slack_one_org_per_workspace",
  },
  {
    fields: { organization: 1 },
    unique: true,
    name: "slack_one_workspace_per_org",
  },
];

let uniquenessIndexesReady: Promise<void> | null = null;

const BaseClass = MakeModelClass({
  schema: slackWorkspaceConnectionSchema,
  collectionName: "slackworkspaceconnections",
  pKey: ["teamId"] as const,
  readonlyFields: [],
  additionalIndexes: connectionIndexes,
});

type SlackWorkspaceConnectionFields = Omit<
  SlackWorkspaceConnectionInterface,
  "organization" | "teamId" | "dateCreated" | "dateUpdated"
>;

export class SlackWorkspaceConnectionModel extends BaseClass {
  // Used before org resolution for signed Slack events and account consent.
  public static async dangerousGetForTeam(
    teamId: string,
  ): Promise<SlackWorkspaceConnectionInterface | null> {
    const docs = await getCollection("slackworkspaceconnections")
      .find({ teamId })
      .limit(2)
      .toArray();
    if (docs.length > 1) {
      throw new Error(
        "This Slack workspace has multiple GrowthBook connections. Disconnect the extra connections before continuing.",
      );
    }
    return docs[0]
      ? slackWorkspaceConnectionSchema.strip().parse(docs[0])
      : null;
  }

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

  private async assertConnectionAvailable(teamId: string): Promise<void> {
    const collection = this._dangerousGetCollection();
    if (
      await collection.findOne({
        teamId,
        organization: { $ne: this.context.org.id },
      })
    ) {
      throw new Error(
        "This Slack workspace is already connected to another GrowthBook organization. Disconnect it from that organization first.",
      );
    }
    if (
      await collection.findOne({
        organization: this.context.org.id,
        teamId: { $ne: teamId },
      })
    ) {
      throw new Error(
        "This GrowthBook organization is already connected to another Slack workspace. Disconnect it before connecting a different workspace.",
      );
    }
  }

  protected async customValidation(doc: SlackWorkspaceConnectionInterface) {
    await this.assertConnectionAvailable(doc.teamId);
  }

  // BaseModel declares these indexes too, but logs and swallows creation
  // failures. assertConnectionAvailable is a read-then-write check, so only the
  // unique indexes close the race between two concurrent connects. Build them
  // once per process before the first write and refuse to write if that fails.
  private ensureUniquenessIndexes(): Promise<void> {
    if (!uniquenessIndexesReady) {
      uniquenessIndexesReady = this._dangerousGetCollection()
        .createIndexes(
          connectionIndexes.map(({ fields, ...options }) => ({
            key: fields,
            ...options,
          })),
        )
        .then(() => undefined)
        .catch((error: unknown) => {
          uniquenessIndexesReady = null;
          throw error;
        });
    }
    return uniquenessIndexesReady;
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
    await this.ensureUniquenessIndexes();
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.getByTeamId(teamId);
      if (existing) {
        return this._updateOne(existing, fields);
      }

      try {
        return await this._createOne({ teamId, ...fields });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await this.assertConnectionAvailable(teamId);
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
