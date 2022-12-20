import mongoose from "mongoose";
import uniqid from "uniqid";
import { ProjectInterface } from "../../types/project";

const projectSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: String,
  dateCreated: Date,
  dateUpdated: Date,
});

type ProjectDocument = mongoose.Document & ProjectInterface;

const ProjectModel = mongoose.model<ProjectDocument>("Project", projectSchema);

function toInterface(doc: ProjectDocument): ProjectInterface {
  return doc.toJSON();
}

export async function createProject(
  organization: string,
  data: Partial<ProjectInterface>
) {
  // TODO: sanitize fields
  const doc = await ProjectModel.create({
    ...data,
    organization,
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
  return doc ? toInterface(doc) : null;
}
export async function deleteProjectById(id: string, organization: string) {
  await ProjectModel.deleteOne({
    id,
    organization,
  });
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
