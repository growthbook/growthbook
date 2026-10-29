import type { Response } from "express";
import omit from "lodash/omit";
import {
  ExperimentIdeaDetail,
  ExperimentIdeaInterface,
  ExperimentIdeaLinkedLearning,
  ExperimentIdeaListItem,
  ExperimentIdeaPriorWork,
  ExperimentIdeaStringDates,
  LearningInterface,
  postExperimentIdeaBody,
  putExperimentIdeaBody,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentIdeaStage } from "shared/types/organization";
import {
  deriveExperimentIdeaStates,
  getExperimentIdeaStages,
  getRemovedStagesInUse,
  validateExperimentIdeaStages,
} from "shared/experiment-ideas";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getExperimentsByIds,
  getExperimentsBySourceExperimentIdeaIds,
} from "back-end/src/models/ExperimentModel";
import { updateOrganization } from "back-end/src/models/OrganizationModel";

type IdParams = { id: string };

function toStringDates(
  idea: ExperimentIdeaInterface,
): ExperimentIdeaStringDates {
  return {
    ...omit(idea, ["organization", "upvotes"]),
    dateCreated: idea.dateCreated.toISOString(),
    dateUpdated: idea.dateUpdated.toISOString(),
    dateArchived: idea.dateArchived ? idea.dateArchived.toISOString() : null,
    powerCheck: idea.powerCheck
      ? {
          ...idea.powerCheck,
          computedAt: idea.powerCheck.computedAt.toISOString(),
        }
      : null,
  };
}

// Learnings are an Enterprise feature; without it nothing Learning-related
// is exposed, not even derived counts.
async function getReadableLearnings(
  context: ReqContext,
): Promise<LearningInterface[]> {
  if (!context.hasPremiumFeature("learnings")) return [];
  return context.models.learnings.getAll();
}

async function buildListItems(
  context: ReqContext,
  ideas: ExperimentIdeaInterface[],
): Promise<{
  items: ExperimentIdeaListItem[];
  experimentsByIdea: Map<string, ExperimentInterface[]>;
  learnings: LearningInterface[];
}> {
  const experiments = await getExperimentsBySourceExperimentIdeaIds(
    context,
    ideas.map((i) => i.id),
  );
  const experimentsByIdea = new Map<string, ExperimentInterface[]>();
  experiments.forEach((e) => {
    if (!e.sourceExperimentIdeaId) return;
    const list = experimentsByIdea.get(e.sourceExperimentIdeaId) ?? [];
    list.push(e);
    experimentsByIdea.set(e.sourceExperimentIdeaId, list);
  });

  const learnings = experiments.length
    ? await getReadableLearnings(context)
    : [];
  const citedExperimentIds = new Set(
    learnings.flatMap((l) => [
      ...l.supportingExperimentIds,
      ...l.contradictingExperimentIds,
    ]),
  );

  const userId = context.userId;
  const items = ideas.map((idea) => {
    const linked = experimentsByIdea.get(idea.id) ?? [];
    return {
      ...toStringDates(idea),
      upvoteCount: idea.upvotes.length,
      upvotedByMe: !!userId && idea.upvotes.includes(userId),
      linkedExperimentCount: linked.length,
      derivedStates: deriveExperimentIdeaStates({
        experiments: linked,
        hasLearning: linked.some((e) => citedExperimentIds.has(e.id)),
      }),
      canManage: context.models.experimentIdeas.canManageIdea(idea),
    };
  });

  return { items, experimentsByIdea, learnings };
}

async function getIdeaOrThrow(
  context: ReqContext,
  id: string,
): Promise<ExperimentIdeaInterface> {
  const idea = await context.models.experimentIdeas.getById(id);
  if (!idea) throw new Error("Experiment Idea not found");
  return idea;
}

async function resolvePriorWork(
  context: ReqContext,
  idea: ExperimentIdeaInterface,
): Promise<ExperimentIdeaPriorWork[]> {
  const experimentIds = idea.informedBy
    .filter((r) => r.kind === "experiment")
    .map((r) => r.id);
  const learningIds = idea.informedBy
    .filter((r) => r.kind === "learning")
    .map((r) => r.id);

  const [experiments, learnings] = await Promise.all([
    getExperimentsByIds(context, experimentIds),
    learningIds.length && context.hasPremiumFeature("learnings")
      ? context.models.learnings.getByIds(learningIds)
      : Promise.resolve([] as LearningInterface[]),
  ]);
  const experimentMap = new Map(experiments.map((e) => [e.id, e]));
  const learningMap = new Map(learnings.map((l) => [l.id, l]));

  // Inaccessible references are dropped rather than shown as raw ids.
  const result: ExperimentIdeaPriorWork[] = [];
  idea.informedBy.forEach((ref) => {
    if (ref.kind === "experiment") {
      const e = experimentMap.get(ref.id);
      if (e) {
        result.push({
          kind: "experiment",
          id: e.id,
          name: e.name,
          status: e.status,
        });
      }
    } else {
      const l = learningMap.get(ref.id);
      if (l) result.push({ kind: "learning", id: l.id, name: l.title });
    }
  });
  return result;
}

async function validateInformedBy(
  context: ReqContext,
  informedBy: ExperimentIdeaInterface["informedBy"] | undefined,
) {
  if (!informedBy?.length) return;
  const resolved = await resolvePriorWork(context, {
    informedBy,
  } as ExperimentIdeaInterface);
  if (resolved.length !== informedBy.length) {
    throw new Error("One or more prior work references could not be found");
  }
}

function appendAuthor(authors: string[], userId: string): string[] {
  return userId && !authors.includes(userId) ? [...authors, userId] : authors;
}

export const getExperimentIdeas = async (
  req: AuthRequest<null, null, { includeArchived?: string }>,
  res: Response<{ status: 200; ideas: ExperimentIdeaListItem[] }>,
) => {
  const context = getContextFromReq(req);
  const ideas = await context.models.experimentIdeas.getAllIdeas({
    includeArchived: req.query.includeArchived === "true",
  });
  const { items } = await buildListItems(context, ideas);
  res.status(200).json({ status: 200, ideas: items });
};

export const getExperimentIdea = async (
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200; idea: ExperimentIdeaDetail }>,
) => {
  const context = getContextFromReq(req);
  const idea = await getIdeaOrThrow(context, req.params.id);
  const {
    items: [item],
    experimentsByIdea,
    learnings,
  } = await buildListItems(context, [idea]);
  const linked = experimentsByIdea.get(idea.id) ?? [];
  const linkedIds = new Set(linked.map((e) => e.id));

  const resultingLearnings: ExperimentIdeaLinkedLearning[] = [];
  learnings.forEach((l) => {
    const supporting = l.supportingExperimentIds.filter((id) =>
      linkedIds.has(id),
    );
    const contradicting = l.contradictingExperimentIds.filter((id) =>
      linkedIds.has(id),
    );
    if (supporting.length || contradicting.length) {
      resultingLearnings.push({
        id: l.id,
        title: l.title,
        relation: supporting.length ? "supporting" : "contradicting",
        experimentIds: [...supporting, ...contradicting],
      });
    }
  });

  res.status(200).json({
    status: 200,
    idea: {
      ...item,
      upvotes: idea.upvotes,
      linkedExperiments: linked.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        results: e.results,
        dateCreated: e.dateCreated.toISOString(),
      })),
      resultingLearnings,
      priorWork: await resolvePriorWork(context, idea),
    },
  });
};

export const postExperimentIdea = async (
  req: AuthRequest<unknown>,
  res: Response<{ status: 200; idea: ExperimentIdeaStringDates }>,
) => {
  const context = getContextFromReq(req);
  const body = postExperimentIdeaBody.parse(req.body);
  await validateInformedBy(context, body.informedBy);

  const { defaultStageId } = getExperimentIdeaStages(context.org.settings);
  const userId = context.userId;
  const idea = await context.models.experimentIdeas.create({
    title: body.title,
    description: body.description ?? "",
    hypothesis: body.hypothesis ?? "",
    expectedOutcome: body.expectedOutcome ?? "",
    rationale: body.rationale ?? "",
    productArea: body.productArea ?? "",
    project: body.project ?? "",
    stage: body.stage || defaultStageId,
    tags: body.tags ?? [],
    metricIds: body.metricIds ?? [],
    goalMetricId: body.goalMetricId ?? "",
    analyticsDashboardId: body.analyticsDashboardId ?? "",
    informedBy: body.informedBy ?? [],
    customFields: body.customFields ?? {},
    owner: userId,
    createdBy: userId,
    authors: userId ? [userId] : [],
    source: "manual",
    powerCheck: null,
    archived: false,
    dateArchived: null,
    archivedBy: null,
    upvotes: [],
  });

  res.status(200).json({ status: 200, idea: toStringDates(idea) });
};

export const putExperimentIdea = async (
  req: AuthRequest<unknown, IdParams>,
  res: Response<{ status: 200; idea: ExperimentIdeaStringDates }>,
) => {
  const context = getContextFromReq(req);
  const body = putExperimentIdeaBody.parse(req.body);
  const existing = await getIdeaOrThrow(context, req.params.id);
  if (body.informedBy) await validateInformedBy(context, body.informedBy);

  const updated = await context.models.experimentIdeas.update(existing, {
    ...body,
    authors: appendAuthor(existing.authors, context.userId),
  });
  res.status(200).json({ status: 200, idea: toStringDates(updated) });
};

export const postArchiveExperimentIdea = async (
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const existing = await getIdeaOrThrow(context, req.params.id);
  await context.models.experimentIdeas.update(existing, {
    archived: true,
    dateArchived: new Date(),
    archivedBy: context.userId || null,
  });
  res.status(200).json({ status: 200 });
};

export const postRestoreExperimentIdea = async (
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const existing = await getIdeaOrThrow(context, req.params.id);
  await context.models.experimentIdeas.update(existing, {
    archived: false,
    dateArchived: null,
    archivedBy: null,
  });
  res.status(200).json({ status: 200 });
};

export const deleteExperimentIdea = async (
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const existing = await getIdeaOrThrow(context, req.params.id);
  await context.models.experimentIdeas.delete(existing);
  res.status(200).json({ status: 200 });
};

// Voting needs read access only; it is not an edit.
async function setUpvote(
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200 }>,
  upvoted: boolean,
) {
  const context = getContextFromReq(req);
  if (!context.userId) {
    throw new Error("Only signed-in members can upvote");
  }
  const idea = await getIdeaOrThrow(context, req.params.id);
  await context.models.experimentIdeas.setUpvote(idea, context.userId, upvoted);
  res.status(200).json({ status: 200 });
}

export const postExperimentIdeaUpvote = (
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200 }>,
) => setUpvote(req, res, true);

export const deleteExperimentIdeaUpvote = (
  req: AuthRequest<null, IdParams>,
  res: Response<{ status: 200 }>,
) => setUpvote(req, res, false);

export const putExperimentIdeaStages = async (
  req: AuthRequest<{
    stages: ExperimentIdeaStage[];
    defaultStageId: string;
  }>,
  res: Response<{ status: 200 } | { status: 400; message: string }>,
) => {
  const context = getContextFromReq(req);
  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }
  const { stages, defaultStageId } = req.body;
  const cleaned = stages.map((s) => ({ ...s, label: s.label.trim() }));

  const error = validateExperimentIdeaStages(cleaned, defaultStageId);
  if (error) {
    return res.status(400).json({ status: 400, message: error });
  }

  const previous = getExperimentIdeaStages(context.org.settings).stages;
  const removed = previous
    .map((s) => s.id)
    .filter((id) => !cleaned.some((s) => s.id === id));
  if (removed.length) {
    const ideas = await context.models.experimentIdeas.getAllIdeas({
      includeArchived: true,
    });
    const inUse = getRemovedStagesInUse(
      previous,
      cleaned,
      ideas.map((i) => i.stage),
    );
    if (inUse.length) {
      const labels = previous
        .filter((s) => inUse.includes(s.id))
        .map((s) => s.label);
      return res.status(400).json({
        status: 400,
        message: `Move Experiment Ideas out of ${labels.join(", ")} before removing ${inUse.length > 1 ? "those stages" : "that stage"}`,
      });
    }
  }

  await updateOrganization(context.org.id, {
    settings: {
      ...context.org.settings,
      experimentIdeaStages: cleaned,
      defaultExperimentIdeaStage: defaultStageId,
    },
  });
  res.status(200).json({ status: 200 });
};
