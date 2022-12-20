import uniqid from "uniqid";
import { FilterQuery } from "mongoose";
import { IdeaDocument, IdeaModel } from "../models/IdeasModel";
import { addTags } from "../models/TagModel";
import { IdeaInterface } from "../../types/idea";

export function getIdeasByOrganization(organization: string, project?: string) {
  const query: FilterQuery<IdeaDocument> = {
    organization,
  };

  if (project) {
    query.project = project;
  }

  return IdeaModel.find(query);
}

export function getIdeasByQuery(query: FilterQuery<IdeaDocument>) {
  return IdeaModel.find(query);
}

export async function createIdea(data: Partial<IdeaInterface>) {
  const idea = await IdeaModel.create({
    // Default values that can be overridden

    // The data object passed in
    ...data,
    // Values that cannot be overridden
    id: uniqid("idea_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  if (idea.tags) {
    await addTags(idea.organization, idea.tags);
  }

  return idea;
}

export function getIdeaById(id: string) {
  return IdeaModel.findOne({
    id,
  });
}

export function getIdeasByIds(ids: string[]) {
  return IdeaModel.find({
    id: { $in: ids },
  });
}

export function getIdeasByExperimentIds(ids: string[]) {
  const tmp: { experimentId: string }[] = [];
  ids.map((id) => {
    tmp.push({ experimentId: id });
  });
  return IdeaModel.find({
    evidence: { $in: tmp },
  });
}

export function deleteIdeaById(id: string) {
  return IdeaModel.deleteOne({
    id,
  });
}
