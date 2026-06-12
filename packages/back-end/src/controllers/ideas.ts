import { Response } from "express";
import { IdeaInterface } from "shared/types/idea";
import { Vote } from "shared/types/vote";
import { UpdateProps } from "shared/types/base-model";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getImpactEstimate,
  ImpactEstimateModel,
} from "back-end/src/models/ImpactEstimateModel";
import { getExperimentByIdea } from "back-end/src/models/ExperimentModel";

export async function getIdeas(
  // eslint-disable-next-line
  req: AuthRequest<any, any, { project?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query.project === "string") {
    project = req.query.project;
  }

  const ideas = await context.models.ideas.getAllByProject(
    project || undefined,
  );

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
  req: AuthRequest<Partial<IdeaInterface> & Pick<IdeaInterface, "text">>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { userId } = context;
  const data = req.body;

  // create() enforces canCreateIdea via the model's permission check
  const idea = await context.models.ideas.create({
    text: data.text,
    details: data.details,
    userName: data.userName,
    project: data.project,
    tags: data.tags ?? [],
    estimateParams: data.estimateParams,
    archived: data.archived ?? false,
    impactScore: data.impactScore ?? 0,
    experimentLength: data.experimentLength ?? 0,
    source: "web",
    userId,
  });

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

  const idea = await context.models.ideas.getById(id);

  if (!idea) {
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

  const experiment = await getExperimentByIdea(context, idea.id);

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
  const context = getContextFromReq(req);

  const idea = await context.models.ideas.getById(id);
  const data = req.body;

  if (!idea) {
    res.status(404).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  const updates: UpdateProps<IdeaInterface> = {};
  data.text && (updates.text = data.text);
  "details" in data && (updates.details = data.details);
  "project" in data && (updates.project = data.project);
  "tags" in data && (updates.tags = data.tags);
  "archived" in data && (updates.archived = data.archived);
  "impactScore" in data && (updates.impactScore = data.impactScore);
  data.experimentLength && (updates.experimentLength = data.experimentLength);
  data.estimateParams && (updates.estimateParams = data.estimateParams);

  // update() enforces canUpdateIdea via the model's permission check
  const updated = await context.models.ideas.update(idea, updates);

  res.status(200).json({
    status: 200,
    idea: updated,
  });
}

export async function deleteIdea(
  req: AuthRequest<IdeaInterface, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const idea = await context.models.ideas.getById(id);

  if (!idea) {
    res.status(404).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  // note: we might want to change this to change the status to
  // 'deleted' instead of actually deleting the document.
  // delete() enforces canDeleteIdea via the model's permission check
  await context.models.ideas.delete(idea);

  res.status(200).json({
    status: 200,
  });
}

export async function postVote(
  req: AuthRequest<Partial<Vote>, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const data = req.body;
  const context = getContextFromReq(req);
  const { userId } = context;

  const idea = await context.models.ideas.getById(id);

  if (!idea) {
    res.status(404).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  try {
    const newVote: 1 | -1 = (data.dir || 1) > 0 ? 1 : -1;
    let found = false;
    const votes: Vote[] = (idea.votes || []).map((v) => {
      if (v.userId === userId) {
        // they have changed their vote, or are voting again
        found = true;
        return { ...v, dir: newVote, dateUpdated: new Date() };
      }
      return v;
    });
    if (!found) {
      // add the vote
      votes.push({
        userId,
        dir: newVote,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });
    }

    // Voting historically only required being a member of the org (no
    // createIdeas permission), so bypass the canUpdate check here.
    const updated = await context.models.ideas.dangerousUpdateBypassPermission(
      idea,
      { votes },
    );

    res.status(200).json({
      status: 200,
      idea: updated,
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
  const context = getContextFromReq(req);
  const { num } = req.params;
  let intNum = parseInt(num);
  if (intNum > 100) intNum = 100;

  try {
    let project = "";
    if (typeof req.query.project === "string" && req.query.project) {
      project = req.query.project;
    }

    const recentIdeas = await context.models.ideas.getRecent(
      intNum,
      project || undefined,
    );

    res.status(200).json({
      status: 200,
      ideas: recentIdeas,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}
