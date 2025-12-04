import { Response } from "express";
import { FilterQuery } from "mongoose";
import { IdeaInterface } from "shared/types/idea";
import { Vote } from "shared/types/vote";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getIdeasByOrganization,
  createIdea,
  getIdeaById,
  deleteIdeaById,
  getIdeasByQuery,
} from "back-end/src/services/ideas";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getImpactEstimate,
  ImpactEstimateModel,
} from "back-end/src/models/ImpactEstimateModel";
import { IdeaDocument } from "back-end/src/models/IdeasModel";
import { getExperimentByIdea } from "back-end/src/models/ExperimentModel";

export async function getIdeas(
  // eslint-disable-next-line
  req: AuthRequest<any, any, { project?: string }>,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  let project = "";
  if (typeof req.query.project === "string") {
    project = req.query.project;
  }

  const ideas = await getIdeasByOrganization(org.id, project);

  res.status(200).json({
    status: 200,
    ideas,
  });
}

export async function getEstimatedImpact(
  req: AuthRequest<{ metric: string; segment?: string }>,
  res: Response,
) {
  const { metric, segment } = req.body;

  const context = getContextFromReq(req);
  const estimate = await getImpactEstimate(
    context,
    metric,
    context.org.settings?.metricAnalysisDays || 30,
    segment,
  );

  res.status(200).json({
    status: 200,
    estimate,
  });
}

/**
 * Creates a new idea
 * @param req
 * @param res
 */
export async function postIdeas(
  req: AuthRequest<Partial<IdeaInterface>>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const data = req.body;

  if (!context.permissions.canCreateIdea(data)) {
    context.permissions.throwPermissionError();
  }
  data.organization = org.id;
  data.source = "web";
  data.userId = userId;
  const idea = await createIdea(data);

  res.status(200).json({
    status: 200,
    idea,
  });
}

export async function getIdea(
  req: AuthRequest<Partial<IdeaInterface>, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const idea = await getIdeaById(id);

  if (!idea || idea.organization !== context.org.id) {
    res.status(404).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  let estimate = null;
  if (idea.estimateParams?.estimate) {
    estimate = await ImpactEstimateModel.findOne({
      id: idea.estimateParams.estimate,
    });
    if (estimate && estimate.organization !== idea.organization) {
      req.log.error(
        {
          estimateId: estimate.id,
          estimateOrg: estimate.organization,
          ideaOrg: idea.organization,
        },
        "Estimate org does not match idea org",
      );
      estimate = null;
    }
  }

  const experiment = await getExperimentByIdea(context, idea);

  res.status(200).json({
    status: 200,
    idea,
    estimate,
    experiment: experiment
      ? {
          id: experiment.id,
          name: experiment.name,
          status: experiment.status,
          archived: experiment.archived,
        }
      : null,
  });
}

/**
 * Update a Idea
 * @param req
 * @param res
 */
export async function postIdea(
  req: AuthRequest<IdeaInterface, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const idea = await getIdeaById(id);
  const data = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  if (idea.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  if (!context.permissions.canUpdateIdea(idea, data)) {
    context.permissions.throwPermissionError();
  }
  const existing = idea.toJSON();

  data.text && idea.set("text", data.text);
  "details" in data && idea.set("details", data.details);
  "project" in data && idea.set("project", data.project);
  "tags" in data && idea.set("tags", data.tags);
  "archived" in data && idea.set("archived", data.archived);
  data.votes && idea.set("votes", data.votes);
  "impactScore" in data && idea.set("impactScore", data.impactScore);
  data.experimentLength && idea.set("experimentLength", data.experimentLength);
  data.estimateParams && idea.set("estimateParams", data.estimateParams);

  await idea.save();

  if (data.tags && data.tags.length > 0) {
    await addTagsDiff(org.id, existing.tags || [], data.tags);
  }

  res.status(200).json({
    status: 200,
    idea,
  });
}

export async function deleteIdea(
  req: AuthRequest<IdeaInterface, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const idea = await getIdeaById(id);
  const context = getContextFromReq(req);
  const { org } = context;

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  if (idea.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  if (!context.permissions.canDeleteIdea(idea)) {
    context.permissions.throwPermissionError();
  }

  // note: we might want to change this to change the status to
  // 'deleted' instead of actually deleting the document.
  const del = await deleteIdeaById(idea.id);

  res.status(200).json({
    status: 200,
    result: del,
  });
}

export async function postVote(
  req: AuthRequest<Partial<Vote>, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const data = req.body;
  const idea = await getIdeaById(id);

  const { org, userId } = getContextFromReq(req);

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }
  if (idea.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  try {
    const newVote = (data.dir || 1) > 0 ? 1 : -1;
    let found = false;
    if (idea.votes) {
      // you can only vote once, see if they've already voted
      idea.votes.map((v) => {
        if (v.userId === userId) {
          // they have changed their vote, or are voting again
          v.dir = newVote;
          v.dateUpdated = new Date();
          found = true;
        }
      });
    }
    if (!found) {
      // add the vote:
      const v: Vote = {
        userId: userId,
        dir: newVote,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      idea.votes = idea.votes || [];
      idea.votes.push(v);
    }

    await idea.save();

    res.status(200).json({
      status: 200,
      idea: idea,
    });
  } catch (e) {
    req.log.error(e, "Failed to vote");
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getRecentIdeas(
  req: AuthRequest<unknown, { num: string }, { project?: string }>,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { num } = req.params;
  let intNum = parseInt(num);
  if (intNum > 100) intNum = 100;

  try {
    const query: FilterQuery<IdeaDocument> = {
      organization: org.id,
    };
    if (typeof req.query.project === "string" && req.query.project) {
      query.project = req.query.project;
    }

    // since deletes can update the dateUpdated, we want to give ourselves a bit of buffer.
    const ideas = await getIdeasByQuery(query)
      .sort({ dateUpdated: -1 })
      .limit(intNum + 5);

    const recentIdeas = ideas.sort(
      (a, b) => b.dateCreated.getTime() - a.dateCreated.getTime(),
    );
    res.status(200).json({
      status: 200,
      ideas: recentIdeas.slice(0, intNum),
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}
