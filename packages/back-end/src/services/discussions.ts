import uniqid from "uniqid";
import { Comment, DiscussionParentType } from "shared/types/discussion";
import { DiscussionModel } from "back-end/src/models/DiscussionModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getMetricById } from "back-end/src/models/MetricModel";
import { ReqContext } from "back-end/types/request";
import { getIdeaById } from "./ideas";

export async function getDiscussionByParent(
  organization: string,
  parentType: DiscussionParentType,
  parentId: string,
) {
  return await DiscussionModel.findOne({
    organization,
    parentType,
    parentId,
  });
}

export async function getAllDiscussionsByOrg(organization: string) {
  return await DiscussionModel.find({
    organization,
  });
}

// Batch comment counts for many parents at once (e.g. every card in a list)
// so list views don't need one GET /discussion/:type/:id call per item.
// Parents with no discussion doc are simply absent from the returned map.
export async function getDiscussionCommentCounts(
  organization: string,
  parentType: DiscussionParentType,
  parentIds: string[],
): Promise<Record<string, number>> {
  if (!parentIds.length) return {};

  const rows = await DiscussionModel.aggregate<{
    parentId: string;
    count: number;
  }>([
    { $match: { organization, parentType, parentId: { $in: parentIds } } },
    {
      $project: {
        _id: 0,
        parentId: 1,
        count: { $size: { $ifNull: ["$comments", []] } },
      },
    },
  ]);

  const counts: Record<string, number> = {};
  rows.forEach((row) => {
    counts[row.parentId] = row.count;
  });
  return counts;
}

export async function getProjectsByParentId(
  context: ReqContext,
  parentType: DiscussionParentType,
  parentId: string,
): Promise<string[]> {
  switch (parentType) {
    case "experiment": {
      const experiment = await getExperimentById(context, parentId);

      if (!experiment) {
        throw new Error("Experiment not found");
      }

      return experiment.project ? [experiment.project] : [];
    }

    case "feature": {
      const feature = await getFeature(context, parentId);

      if (!feature) {
        throw Error("Feature not found");
      }

      return feature.project ? [feature.project] : [];
    }

    case "idea": {
      const idea = await getIdeaById(parentId);

      if (!idea) {
        throw Error("Idea not found");
      }

      return idea.project ? [idea.project] : [];
    }

    case "metric": {
      const metric = await getMetricById(context, parentId);

      if (!metric) {
        throw new Error("Metric not found");
      }

      return metric.projects || [];
    }

    case "insight": {
      const insight = await context.models.insights.getById(parentId);

      if (!insight) {
        throw new Error("Insight not found");
      }

      return insight.projects || [];
    }
  }
}

export async function getAllDiscussionsByOrgFromDate(
  organization: string,
  date: Date,
) {
  return await DiscussionModel.find({
    organization,
    dateUpdated: { $gte: date },
  });
}

export async function getLastNDiscussions(organization: string, num: number) {
  return await DiscussionModel.find({
    organization,
  })
    .sort({ dateUpdated: -1 })
    .limit(num);
}

export async function addComment(
  organization: string,
  parentType: DiscussionParentType,
  parentId: string,
  user: { id: string; email: string; name: string },
  comment: string,
) {
  const newComment: Comment = {
    content: comment,
    date: new Date(),
    userEmail: user.email,
    userId: user.id,
    userName: user.name,
  };

  const discussion = await getDiscussionByParent(
    organization,
    parentType,
    parentId,
  );
  // Comment thread already exists
  if (discussion && discussion.id) {
    discussion.comments.push(newComment);
    discussion.dateUpdated = new Date();
    discussion.markModified("comments");
    await discussion.save();
    return;
  }

  // Doesn't exist, create it
  await DiscussionModel.create({
    id: uniqid("com_"),
    organization,
    parentType,
    parentId,
    comments: [newComment],
    dateUpdated: new Date(),
  });
}
