import uniqid from "uniqid";
import { FilterQuery } from "mongoose";
import { ReadAccessFilter, hasReadAccess } from "shared/permissions";
import { IdeaDocument, IdeaModel } from "../models/IdeasModel";
import { addTags } from "../models/TagModel";
import { IdeaInterface } from "../../types/idea";

export async function getIdeasByOrganization(
  organization: string,
  readAccessFilter: ReadAccessFilter,
  project?: string
) {
  const query: FilterQuery<IdeaDocument> = {
    organization,
  };

  if (project) {
    query.project = project;
  }

  const ideas = await IdeaModel.find(query);

  return ideas.filter((idea) =>
    hasReadAccess(readAccessFilter, [idea.project || ""])
  );
}

export async function getIdeasByQuery(
  query: FilterQuery<IdeaDocument>,
  readAccessFilter: ReadAccessFilter
) {
  const ideas = await IdeaModel.find(query);

  return ideas.filter((idea) =>
    hasReadAccess(readAccessFilter, [idea.project || ""])
  );
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

export async function getIdeaById(
  id: string,
  readAccessFilter: ReadAccessFilter
) {
  const idea = await IdeaModel.findOne({
    id,
  });

  return idea && hasReadAccess(readAccessFilter, [idea.project || ""])
    ? idea
    : null;
}

export function deleteIdeaById(id: string) {
  return IdeaModel.deleteOne({
    id,
  });
}
