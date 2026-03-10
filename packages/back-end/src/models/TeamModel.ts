import {
  apiAddTeamMembersValidator,
  apiCreateTeamBody,
  apiDeleteTeamValidator,
  apiDeleteTeamReturn,
  apiRemoveTeamMemberValidator,
  apiTeamValidator,
  apiUpdateTeamBody,
  teamSchema,
  ApiDeleteTeamReturn,
} from "shared/validators";
import { ApiTeamInterface, TeamInterface } from "shared/types/team";
import { areProjectRolesValid, isRoleValid } from "shared/permissions";
import { stringToBoolean } from "shared/util";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  addMembersToTeam,
  getMembersOfTeam,
  removeMembersFromTeam,
} from "back-end/src/services/organizations";
import { statusCodeReturn } from "back-end/src/util/handler";
import { MakeModelClass } from "./BaseModel";

const COLLECTION = "teams";
const BaseClass = MakeModelClass({
  schema: teamSchema,
  collectionName: COLLECTION,
  idPrefix: "team_",
  globallyUniquePrimaryKeys: false,
  readonlyFields: [],
  additionalIndexes: [],
  defaultValues: {
    createdBy: "",
    limitAccessByEnvironment: false,
    environments: [],
    managedByIdp: false,
  },
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
    crudActions: ["get", "create", "list", "update"],
    customHandlers: [
      defineCustomApiHandler({
        pathFragment: "/:teamId/members",
        verb: "post",
        operationId: "addTeamMembers",
        validator: apiAddTeamMembersValidator,
        zodReturnObject: statusCodeReturn,
        summary: "Add members to team",
        reqHandler: async (req) => {
          if (!req.context.permissions.canManageTeam())
            req.context.permissions.throwPermissionError();
          const team = await req.context.models.teams.getById(
            req.params.teamId,
          );
          if (!team) return req.context.throwNotFoundError();
          await addMembersToTeam({
            organization: req.context.org,
            userIds: req.body.members,
            teamId: team.id,
          });
          return {
            status: 200,
          };
        },
      }),
      defineCustomApiHandler({
        pathFragment: "/:teamId/members",
        verb: "delete",
        operationId: "removeTeamMember",
        validator: apiRemoveTeamMemberValidator,
        zodReturnObject: statusCodeReturn,
        summary: "Remove members from team",
        reqHandler: async (req) => {
          if (!req.context.permissions.canManageTeam())
            req.context.permissions.throwPermissionError();
          const team = await req.context.models.teams.getById(
            req.params.teamId,
          );
          if (!team) return req.context.throwNotFoundError();
          await removeMembersFromTeam({
            organization: req.context.org,
            userIds: req.body.members,
            teamId: team.id,
          });
          return {
            status: 200,
          };
        },
      }),
      defineCustomApiHandler({
        pathFragment: "/:teamId/",
        verb: "delete",
        operationId: "deleteTeam",
        validator: apiDeleteTeamValidator,
        zodReturnObject: apiDeleteTeamReturn,
        summary: "Delete a single team",
        reqHandler: async (req): Promise<ApiDeleteTeamReturn> => {
          if (!req.context.permissions.canManageTeam())
            req.context.permissions.throwPermissionError();
          const team = await req.context.models.teams.getById(
            req.params.teamId,
          );
          if (!team) return req.context.throwNotFoundError();
          if (stringToBoolean(req.query.deleteMembers)) {
            await removeMembersFromTeam({
              organization: req.context.org,
              userIds: getMembersOfTeam(req.context.org, team.id),
              teamId: team.id,
            });
          }
          await req.context.models.teams.delete(team);
          return {
            deletedId: team.id,
          };
        },
      }),
    ],
  },
});

export class TeamModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.permissions.canManageTeam();
  }
  protected canRead(): boolean {
    // Teams aren't project-scoped and they're used to build a user's permissions, so the `readData` check doesn't work
    return true;
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageTeam();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canManageTeam();
  }

  protected async customValidation(doc: TeamInterface) {
    if (
      !isRoleValid(doc.role, this.context.org) ||
      !areProjectRolesValid(doc.projectRoles, this.context.org)
    ) {
      return this.context.throwBadRequestError("Invalid role");
    }
  }

  protected async beforeDelete(team: TeamInterface) {
    const org = this.context.org;
    const members = getMembersOfTeam(org, team.id);

    if (members.length !== 0) {
      return this.context.throwBadRequestError(
        "Cannot delete a team that has members. Please delete members before retrying.",
      );
    }

    if (team?.managedByIdp && !this.context.isApiRequest) {
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

  protected toApiInterface(doc: TeamInterface): ApiTeamInterface {
    const members = getMembersOfTeam(this.context.org, doc.id);
    return {
      ...doc,
      members,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
    };
  }
}
