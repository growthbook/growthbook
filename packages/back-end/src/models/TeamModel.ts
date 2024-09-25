import mongoose from "mongoose";
import uniqid from "uniqid";
import { TeamInterface } from "back-end/types/team";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";

const teamSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  name: String,
  organization: {
    type: String,
    index: true,
  },
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

const TeamModel = mongoose.model<TeamInterface>("Team", teamSchema);
const COLLECTION = "teams";

const toInterface: ToInterface<TeamInterface> = (doc) =>
  removeMongooseFields(doc);

type CreateTeamProps = Omit<
  TeamInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateTeamProps = Partial<TeamInterface>;

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

export async function getTeamsForOrganization(orgId: string) {
  const docs = await getCollection(COLLECTION)
    .find({
      organization: orgId,
    })
    .toArray();

  return docs.map((d) => toInterface(d));
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
