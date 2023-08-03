import mongoose from "mongoose";
import { TeamInterface } from "../../types/organization";

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
  globalRole: String,
  projectRoles: [
    {
      _id: false,
      project: String,
      role: String,
      limitAccessByEnvironment: Boolean,
      environments: [String],
    },
  ],
  limitAccessByEnvironment: Boolean,
  environments: [String],
});

type TeamDocument = mongoose.Document & TeamInterface;

const TeamModel = mongoose.model<TeamInterface>("Team", teamSchema);

function toInterface(doc: TeamDocument): TeamInterface {
  return doc.toJSON();
}

export async function createTeam(
  team: Partial<TeamInterface>
): Promise<TeamInterface> {
  return toInterface(await TeamModel.create(team));
}

export async function getTeamById(teamId: string) {
  const teamData = await TeamModel.findById(teamId);
  return teamData ? toInterface(teamData) : null;
}
