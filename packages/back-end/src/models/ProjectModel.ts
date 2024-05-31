import mongoose from "mongoose";
import uniqid from "uniqid";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { omit } from "lodash";
import { ApiProject } from "../../types/openapi";
import { ProjectInterface, ProjectSettings } from "../../types/project";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";

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

const ProjectModel = mongoose.model<ProjectInterface>("Project", projectSchema);

function toInterface(doc: ProjectDocument): ProjectInterface {
  const ret = doc.toJSON<ProjectDocument>();
  ret.settings = ret.settings || {};
  return omit(ret, ["__v", "_id"]);
}

interface CreateProjectProps {
  name: string;
  description?: string;
  id?: string;
}

export async function createProject(
  organization: string,
  data: CreateProjectProps
) {
  const doc = await ProjectModel.create({
    organization: organization,
    id: data.id || uniqid("prj_"),
    name: data.name || "",
    description: data.description,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(doc);
}
export async function findAllProjectsByOrganization(
  context: ReqContext | ApiReqContext
) {
  const { org } = context;
  const docs = await ProjectModel.find({
    organization: org.id,
  });

  const projects = docs.map(toInterface);
  return projects.filter((p) =>
    context.permissions.canReadSingleProjectResource(p.id)
  );
}
export async function findProjectById(
  context: ReqContext | ApiReqContext,
  projectId: string
) {
  const { org } = context;
  const doc = await ProjectModel.findOne({
    id: projectId,
    organization: org.id,
  });
  if (!doc) return null;

  const project = toInterface(doc);

  return context.permissions.canReadSingleProjectResource(project.id)
    ? project
    : null;
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
  settings: Partial<ProjectSettings>
) {
  const update = {
    $set: {
      dateUpdated: new Date(),
      settings,
    },
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
      statsEngine: project.settings?.statsEngine || DEFAULT_STATS_ENGINE,
    },
  };
}
