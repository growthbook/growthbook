import { teamSchema } from "shared/validators";
import { TeamInterface } from "shared/types/team";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION = "teams";
const BaseClass = MakeModelClass({
  schema: teamSchema,
  collectionName: COLLECTION,
  idPrefix: "team_",
  globallyUniqueIds: false,
  readonlyFields: [],
  additionalIndexes: [],
});

export class TeamModel extends BaseClass {
  protected canCreate(): boolean {
    return true;
    // return this.context.permissions.canCreateEventWebhook();
  }
  protected canRead(): boolean {
    return true;
    // return this.context.permissions.canViewEventWebhook();
  }
  protected canUpdate(): boolean {
    return true;
    // return this.context.permissions.canUpdateEventWebhook();
  }
  protected canDelete(): boolean {
    return true;
    // return this.context.permissions.canDeleteEventWebhook();
  }

  public async findByName(name: string) {
    return this._findOne({
      name: { $regex: name, $options: "i" },
    });
  }

  public static async dangerousGetTeamsForOrganization(
    orgId: string,
  ): Promise<TeamInterface[]> {
    const docs = await getCollection<TeamInterface>(COLLECTION)
      .find({ organization: orgId })
      .toArray();
    return docs.map(removeMongooseFields);
  }

  public static async getAllTeamRoleInfoInDb(): Promise<TeamInterface[]> {
    if (IS_CLOUD) {
      throw new Error("getAllTeamRoleInfoInDb() is not supported on cloud");
    }

    const docs = await getCollection<TeamInterface>(COLLECTION)
      .find({})
      .toArray();
    return docs.map(removeMongooseFields);
  }
}
