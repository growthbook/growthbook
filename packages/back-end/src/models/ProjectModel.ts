import mongoose from "mongoose";
import uniqid from "uniqid";
import { ApiProject } from "../../types/openapi";
import { ProjectInterface, ProjectSettings } from "../../types/project";

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
  description: String,
  dateCreated: Date,
  dateUpdated: Date,
  settings: {},
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

export async function updateProjectSettings(
  id: string,
  organization: string,
  set: Partial<ProjectSettings>,
  unset?: (keyof ProjectSettings)[]
) {
  // prefix set and unset with "settings."
  const setObj = Object.keys(set).reduce(
    (acc, k) => ({
      ...acc,
      [`settings.${k}`]: set[k as keyof ProjectSettings],
    }),
    {}
  );
  // unset: convert to {key: 1, key2: 1, ...} object
  const unsetObj =
    unset
      ?.map((k) => `settings.${k}`)
      ?.reduce(
        (acc, k) => ({
          ...acc,
          [k]: 1,
        }),
        {}
      ) || {};
  const update = {
    $set: {
      dateUpdated: new Date(),
      ...setObj,
    },
    $unset: unsetObj,
  };
  await ProjectModel.updateOne(
    {
      id,
      organization,
    },
    update
  );
}

export function toProjectApiInterface(project: ProjectInterface): ApiProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description || "",
    dateCreated: project.dateCreated.toISOString(),
    dateUpdated: project.dateUpdated.toISOString(),
    settings: {
      statsEngine: project.settings?.statsEngine || "bayesian",
    },
  };
}
