import { IdeaModel } from "../models/IdeasModel";
import uniqid from "uniqid";
import { addTags } from "./tag";
import { IdeaInterface } from "../../types/idea";
//import {query} from "../config/postgres";

export function getIdeasByOrganization(organization: string) {
  return IdeaModel.find({
    organization,
  });
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
