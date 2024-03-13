import mongoose from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { TeamInterface } from "@/types/team";

const teamSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  name: String,
  organization: String,
  dateCreated: Date,
  dateUpdated: Date,
  createdBy: String,
  description: String,
  role: String,
  limitAccessByEnvironment: Boolean,
  environments: [String],
  projectRoles: [
    {
      _id: false,
      project: String,
      role: String,
      limitAccessByEnvironment: Boolean,
      environments: [String],
    },
  ],
  managedByIdp: Boolean,
});

type TeamDocument = mongoose.Document & TeamInterface;

const TeamModel = mongoose.model<TeamInterface>("Team", teamSchema);

type CreateTeamProps = Omit<
  TeamInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateTeamProps = Partial<TeamInterface>;

/**
 * Convert the Mongo document to a TeamInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: TeamDocument): TeamInterface => {
  return omit(doc.toJSON<TeamDocument>(), ["__v", "_id"]);
};

export async function createTeam(
  data: CreateTeamProps
): Promise<TeamInterface> {
  const teamDoc = await TeamModel.create({
    ...data,
    id: uniqid("team_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(teamDoc);
}

export async function findTeamById(
  id: string,
  orgId: string
): Promise<TeamInterface | null> {
  const teamDoc = await TeamModel.findOne({ id, organization: orgId });
  return teamDoc ? toInterface(teamDoc) : null;
}

export async function findTeamByName(
  name: string,
  orgId: string
): Promise<TeamInterface | null> {
  const teamDoc = await TeamModel.findOne({
    name: { $regex: name, $options: "i" },
    organization: orgId,
  });
  return teamDoc ? toInterface(teamDoc) : null;
}

export async function getTeamsForOrganization(
  orgId: string
): Promise<TeamInterface[]> {
  const teamDocs = await TeamModel.find({
    organization: orgId,
  });
  return teamDocs.map((team) => toInterface(team));
}

export async function updateTeamMetadata(
  id: string,
  orgId: string,
  update: UpdateTeamProps
): Promise<UpdateTeamProps> {
  const changes = {
    ...update,
    dateUpdated: new Date(),
  };

  await TeamModel.updateOne(
    {
      id,
      organization: orgId,
    },
    {
      $set: changes,
    }
  );

  return changes;
}

export async function deleteTeam(id: string, orgId: string): Promise<void> {
  await TeamModel.deleteOne({
    id,
    organization: orgId,
  });
}
