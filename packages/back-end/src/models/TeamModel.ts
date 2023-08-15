import mongoose from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { TeamInterface } from "../../types/team";

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
});

type TeamDocument = mongoose.Document & TeamInterface;

const TeamModel = mongoose.model<TeamInterface>("Team", teamSchema);

/**
 * Convert the Mongo document to a TeamInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: TeamDocument): TeamInterface => {
  return omit(doc.toJSON<TeamDocument>(), ["__v", "_id"]);
};

export async function createTeam(
  data: Partial<TeamInterface>
): Promise<TeamInterface> {
  const teamDoc = await TeamModel.create({
    ...data,
    id: uniqid("team_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(teamDoc);
}

export async function findTeamById(id: string): Promise<TeamInterface | null> {
  const teamDoc = await TeamModel.findById(id);
  return teamDoc ? toInterface(teamDoc) : null;
}

// export async function getMembersForTeam(id: string) {}
