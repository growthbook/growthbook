import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  getIdeasByOrganization,
  createIdea,
  getIdeaById,
  deleteIdeaById,
} from "../services/ideas";
import { IdeaInterface } from "../../types/idea";
import { addTagsDiff } from "../services/tag";
import { Vote } from "../../types/vote";
import { userHasAccess } from "../services/organizations";
import {
  getImpactEstimate,
  ImpactEstimateModel,
  createImpactEstimate,
} from "../models/ImpactEstimateModel";
import { ImpactEstimateInterface } from "../../types/impact-estimate";
export async function getIdeas(req: AuthRequest, res: Response) {
  const ideas = await getIdeasByOrganization(req.organization.id);

  res.status(200).json({
    status: 200,
    ideas,
  });
}

export async function getEstimatedImpact(req: AuthRequest, res: Response) {
  const {
    regex,
    metric,
    segment,
  }: { regex: string; metric: string; segment?: string } = req.body;
  const estimate = await getImpactEstimate(
    req.organization.id,
    metric,
    regex,
    segment
  );

  res.status(200).json({
    status: 200,
    estimate,
  });
}

export async function postEstimatedImpactManual(
  req: AuthRequest<Partial<ImpactEstimateInterface>>,
  res: Response
) {
  const { value, metricTotal, users, metric, regex } = req.body;

  const estimate = await createImpactEstimate(
    req.organization.id,
    metric,
    null,
    regex,
    value,
    users,
    metricTotal
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
  res: Response
) {
  const data = req.body;
  data.organization = req.organization.id;
  data.source = "web";
  data.userId = req.userId;
  const idea = await createIdea(data);

  res.status(200).json({
    status: 200,
    idea,
  });
}

export async function getIdea(
  req: AuthRequest<Partial<IdeaInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  //const data = req.body;

  const idea = await getIdeaById(id);

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  if (!(await userHasAccess(req, idea.organization))) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  let estimate = null;
  if (idea.estimateParams?.estimate) {
    estimate = await ImpactEstimateModel.findOne({
      id: idea.estimateParams.estimate,
    });
    if (estimate && estimate.organization !== idea.organization) {
      console.error(
        "Estimate org does not match idea org",
        estimate.id,
        estimate.organization,
        idea.organization
      );
      estimate = null;
    }
  }

  res.status(200).json({
    status: 200,
    idea,
    estimate,
  });
}

/**
 * Update a Idea
 * @param req
 * @param res
 */
export async function postIdea(req: AuthRequest<IdeaInterface>, res: Response) {
  const { id }: { id: string } = req.params;
  const idea = await getIdeaById(id);
  const data = req.body;

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  if (idea.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  const existing = idea.toJSON();

  data.text && idea.set("text", data.text);
  "details" in data && idea.set("details", data.details);
  "tags" in data && idea.set("tags", data.tags);
  "archived" in data && idea.set("archived", data.archived);
  data.votes && idea.set("votes", data.votes);
  "impactScore" in data && idea.set("impactScore", data.impactScore);
  data.experimentLength && idea.set("experimentLength", data.experimentLength);
  data.estimateParams && idea.set("estimateParams", data.estimateParams);

  await idea.save();

  if (data.tags && data.tags.length > 0) {
    await addTagsDiff(req.organization.id, existing.tags || [], data.tags);
  }

  res.status(200).json({
    status: 200,
    idea,
  });
}

export async function deleteIdea(
  req: AuthRequest<IdeaInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const idea = await getIdeaById(id);

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }

  if (idea.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  // note: we might want to change this to change the status to
  // 'deleted' instead of actually deleting the document.
  const del = await deleteIdeaById(idea.id);

  res.status(200).json({
    status: 200,
    result: del,
  });
}

export async function postVote(req: AuthRequest<Partial<Vote>>, res: Response) {
  const { id }: { id: string } = req.params;
  const data = req.body;
  const idea = await getIdeaById(id);

  if (!idea) {
    res.status(403).json({
      status: 404,
      message: "Idea not found",
    });
    return;
  }
  if (idea.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this idea",
    });
    return;
  }

  try {
    const newVote = data.dir > 0 ? 1 : -1;
    let found = false;
    if (idea.votes) {
      // you can only vote once, see if they've already voted
      idea.votes.map((v) => {
        if (v.userId === req.userId) {
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
        userId: req.userId,
        dir: newVote,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      idea.votes.push(v);
    }

    await idea.save();

    res.status(200).json({
      status: 200,
      idea: idea,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
    console.error(e);
  }
}
