import mongoose from "mongoose";
import { ProjectInterface } from "../../types/project";
import uniqid from "uniqid";
import { getConfigProjects, usingFileConfig } from "../init/config";

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
  if (!doc) return null;
  return doc.toJSON();
}

export async function createProject(organization: string, name: string) {
  if (usingFileConfig()) {
    throw new Error(
      "Using config.yml to manage projects, cannot create one in the UI"
    );
  }

  // TODO: sanitize fields
  const doc = await ProjectModel.create({
    organization,
    name,
    id: uniqid("prj_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(doc);
}
export async function findAllProjectsByOrganization(organization: string) {
  if (usingFileConfig()) {
    return getConfigProjects(organization);
  }

  const docs = await ProjectModel.find({
    organization,
  });
  return docs.map(toInterface);
}
export async function findProjectById(id: string, organization: string) {
  if (usingFileConfig()) {
    return getConfigProjects(organization).filter((p) => p.id === id)[0];
  }

  const doc = await ProjectModel.findOne({ id, organization });
  return toInterface(doc);
}
export async function deleteProjectById(id: string, organization: string) {
  if (usingFileConfig()) {
    throw new Error(
      "Using config.yml to manage projects, cannot delete from the UI"
    );
  }

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
  if (usingFileConfig()) {
    throw new Error(
      "Using config.yml to manage projects, cannot update from the UI"
    );
  }

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
