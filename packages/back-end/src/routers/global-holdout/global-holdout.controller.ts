import type { Response } from "express";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { createExperiment, getExperimentById } from "back-end/src/models/ExperimentModel";
import { GlobalHoldoutInterface } from "back-end/src/validators/global-holdout";
import { ExperimentInterface } from "back-end/src/validators/experiments";

// region POST /global-holdout
/**
 * POST /global-holdout
 * Create a new global holdout and its associated experiment
 * @param req
 * @param res
 */
export async function postGlobalHoldout(
  req: AuthRequest<{
    key: string;
    description?: string;
    linkedFeatures?: string[];
    linkedExperiments?: string[];
  }>,
  res: Response<{
    status: 200;
    globalHoldout: GlobalHoldoutInterface;
    experiment: ExperimentInterface;
  }>
) {
  const context = getContextFromReq(req);
  const { key, description, linkedFeatures, linkedExperiments } = req.body;

  // Create the holdout experiment
  const experiment: Partial<ExperimentInterface> = {
    organization: context.org.id,
    name: `Global Holdout: ${key}`,
    type: "holdout",
    trackingKey: key,
    status: "running",
    variations: [
      {
        id: "control",
        key: "control",
        name: "Control",
        description: "Users who will not see the features",
        screenshots: [],
      },
      {
        id: "treatment",
        key: "treatment",
        name: "Treatment",
        description: "Users who will see the features",
        screenshots: [],
      },
    ],
    phases: [
      {
        name: "Main",
        dateStarted: new Date(),
        coverage: 0.2,
        reason: "",
        variationWeights: [0.5, 0.5],
        condition: "{}",
      },
    ],
    hashAttribute: "id",
    hashVersion: 2,
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    owner: context.userId,
    tags: [],
    description: description || "",
    hypothesis: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: "",
    metricOverrides: [],
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    implementation: "code",
    releasedVariationId: "",
    excludeFromPayload: true,
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter: 0.05,
    regressionAdjustmentEnabled: false,
    statsEngine: "bayesian",
    banditScheduleValue: 1,
    banditScheduleUnit: "days",
    banditBurnInValue: 1,
    banditBurnInUnit: "days",
    customFields: {},
    shareLevel: "organization",
  };

  // Create the experiment
  const createdExperiment = await createExperiment({
    data: experiment,
    context,
  });

  // Create the global holdout
  const globalHoldout = await context.models.globalHoldout.create({
    experimentId: createdExperiment.id,
    startedAt: new Date(),
    linkedFeatures: linkedFeatures || [],
    linkedExperiments: linkedExperiments || [],
    description,
  });

  await req.audit({
    event: "globalHoldout.create",
    entity: {
      object: "globalHoldout",
      id: globalHoldout.id,
    },
    details: JSON.stringify({
      description,
      linkedFeatures,
      linkedExperiments,
    }),
  });

  res.status(200).json({
    status: 200,
    globalHoldout,
    experiment: createdExperiment,
  });
}
// endregion POST /global-holdout

// region GET /global-holdout
/**
 * GET /global-holdout
 * List all global holdouts with their associated experiments
 * @param req
 * @param res
 */
export async function getGlobalHoldouts(
  req: AuthRequest,
  res: Response<{
    status: 200;
    globalHoldouts: Array<GlobalHoldoutInterface & {
      experiment: ExperimentInterface | null;
    }>;
  }>
) {
  const context = getContextFromReq(req);
  const globalHoldouts = await context.models.globalHoldout.getAll();

  // Get associated experiments for each holdout
  const holdoutsWithExperiments = await Promise.all(
    globalHoldouts.map(async (holdout: GlobalHoldoutInterface) => {
      const experiment = await getExperimentById(context, holdout.experimentId);
      return {
        ...holdout,
        experiment,
      };
    })
  );

  res.status(200).json({
    status: 200,
    globalHoldouts: holdoutsWithExperiments,
  });
}
// endregion GET /global-holdout
