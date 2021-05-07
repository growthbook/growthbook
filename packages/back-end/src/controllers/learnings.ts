import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  getLearningsByOrganization,
  createLearning,
  getLearningById,
  deleteLearningById,
} from "../services/learnings";
import { LearningInterface } from "../../types/insight";
import { getExperimentById } from "../services/experiments";
import { Vote } from "../../types/vote";
import { addTagsDiff } from "../services/tag";
import { userHasAccess } from "../services/organizations";

export async function getLearnings(req: AuthRequest, res: Response) {
  const learnings = await getLearningsByOrganization(req.organization.id);

  res.status(200).json({
    status: 200,
    learnings,
  });
}

/**
 * Creates a new learning
 * @param req
 * @param res
 */
export async function postLearnings(
  req: AuthRequest<Partial<LearningInterface>>,
  res: Response
) {
  const data = req.body;
  data.organization = req.organization.id;

  data.userId = req.userId;
  const learning = await createLearning(data);

  res.status(200).json({
    status: 200,
    learning,
  });
}

export async function getLearning(
  req: AuthRequest<Partial<LearningInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const learning = await getLearningById(id);

  if (!learning) {
    res.status(403).json({
      status: 404,
      message: "Learning not found",
    });
    return;
  }

  if (!(await userHasAccess(req, learning.organization))) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this learning",
    });
    return;
  }

  // get the experiments for this learning:
  // (could make this an IN query and do it once...)

  const getExperiments = async () => {
    const results = [];
    for (let i = 0; i < learning.evidence.length; i++) {
      results.push(getExperimentById(learning.evidence[i].experimentId));
    }
    return await Promise.all(results);
  };
  const experiments = await getExperiments();

  res.status(200).json({
    status: 200,
    learning,
    experiments,
  });
}

/**
 * Update a learning
 * @param req
 * @param res
 */
export async function postLearning(
  req: AuthRequest<LearningInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const learning = await getLearningById(id);
  const data = req.body;

  if (!learning) {
    res.status(403).json({
      status: 404,
      message: "Learning not found",
    });
    return;
  }

  if (learning.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this learning",
    });
    return;
  }

  const existing = learning.toJSON();

  "text" in data && learning.set("text", data.text);
  "details" in data && learning.set("details", data.details);
  "tags" in data && learning.set("tags", data.tags);
  "evidence" in data && learning.set("evidence", data.evidence);
  "votes" in data && learning.set("votes", data.votes);

  await learning.save();

  if ("tags" in data) {
    await addTagsDiff(
      req.organization.id,
      existing.tags || [],
      data.tags || []
    );
  }

  res.status(200).json({
    status: 200,
    learning,
  });
}

export async function deleteLearning(
  req: AuthRequest<LearningInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const exp = await getLearningById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  // note: we might want to change this to change the status to
  // 'deleted' instead of actually deleting the document.
  const del = await deleteLearningById(exp.id);

  res.status(200).json({
    status: 200,
    result: del,
  });
}

export async function postVote(req: AuthRequest<Partial<Vote>>, res: Response) {
  const { id }: { id: string } = req.params;
  const data = req.body;
  const learning = await getLearningById(id);

  if (!learning) {
    res.status(403).json({
      status: 404,
      message: "Learning not found",
    });
    return;
  }
  if (learning.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this learning",
    });
    return;
  }

  try {
    const newVote = data.dir > 0 ? 1 : -1;
    let found = false;
    if (learning.votes) {
      // you can only vote once, see if they've already voted
      learning.votes.map((v) => {
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

      learning.votes.push(v);
    }

    await learning.save();

    res.status(200).json({
      status: 200,
      learning: learning,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
    console.error(e);
  }
}
