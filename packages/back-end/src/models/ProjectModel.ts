import mongoose from "mongoose";
import { ProjectInterface } from "../../types/project";
import uniqid from "uniqid";

const projectSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  name: String,
  members: [
    {
      _id: false,
      id: String,
      role: String,
    },
  ],
  dateCreated: Date,
  dateUpdated: Date,
});

projectSchema.index({ "members.id": 1 });

type ProjectDocument = mongoose.Document & ProjectInterface;

const ProjectModel = mongoose.model<ProjectDocument>("Project", projectSchema);

function toInterface(doc: ProjectDocument): ProjectInterface {
  if (!doc) return null;
  return doc.toJSON();
}

export async function createProject(
  organization: string,
  userId: string,
  name: string
) {
  // TODO: sanitize fields
  const doc = await ProjectModel.create({
    organization,
    name,
    members: [
      {
        id: userId,
        role: "admin",
      },
    ],
    id: uniqid("prj_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(doc);
}
export async function findAllProjectsByOrganization(organization: string) {
  const docs = await ProjectModel.find({
    organization,
  });
  return docs.map(toInterface);
}
export async function findProjectById(id: string, organization: string) {
  const doc = await ProjectModel.findOne({ id, organization });
  return toInterface(doc);
}
export async function updateProject(
  id: string,
  organization: string,
  update: Partial<ProjectInterface>
) {
  await ProjectModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: update,
    }
  );
}
