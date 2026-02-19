import {
  apiCreateTeamBody,
  apiTeamValidator,
  apiUpdateTeamBody,
  teamSchema,
} from "shared/validators";
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
  apiConfig: {
    modelKey: "teams",
    modelSingular: "team",
    modelPlural: "teams",
    apiInterface: apiTeamValidator,
    schemas: {
      createBody: apiCreateTeamBody,
      updateBody: apiUpdateTeamBody,
    },
    pathBase: "/teams",
    includeDefaultCrud: true,
  },
});

export class TeamModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.permissions.canManageTeam();
  }
  protected canRead(): boolean {
    return this.context.permissions.canManageTeam();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageTeam();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canManageTeam();
  }

  protected async beforeDelete(team: TeamInterface) {
    const org = this.context.org;
    const members = org.members.filter((member) =>
      member.teams?.includes(team.id),
    );

    if (members.length !== 0) {
      return this.context.throwBadRequestError(
        "Cannot delete a team that has members. Please delete members before retrying.",
      );
    }

    if (team?.managedByIdp) {
      return this.context.throwBadRequestError(
        "Cannot delete a team that is being managed by an idP. Please delete the team through your idP.",
      );
    }
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
