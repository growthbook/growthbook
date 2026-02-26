import { Response } from "express";
import uniqid from "uniqid";
import format from "date-fns/format";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getValidDate } from "shared/dates";
import {
  getAffectedEnvsForExperiment,
  getSnapshotAnalysis,
  isDefined,
} from "shared/util";
import {
  expandAllSliceMetricsInMap,
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getAllMetricSettingsForSnapshot,
  createInitialPhase,
  getLatestPhaseVariations,
} from "shared/experiments";
import { getScopedSettings } from "shared/settings";
import { v4 as uuidv4 } from "uuid";
import uniq from "lodash/uniq";
import { IdeaInterface } from "shared/types/idea";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { DataSourceInterface } from "shared/types/datasource";
import { MetricInterface, MetricStats } from "shared/types/metric";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  ExperimentStatus,
  ExperimentTargetingData,
  ExperimentType,
  Variation,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotTriggeredBy,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { OrganizationSettings } from "shared/types/organization";
import { CreateURLRedirectProps } from "shared/types/url-redirect";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import {
  _getSnapshots,
  createSnapshot,
  createSnapshotAnalyses,
  createSnapshotAnalysis,
  determineNextBanditSchedule,
  getAdditionalExperimentAnalysisSettings,
  getChangesToStartExperiment,
  getDefaultExperimentAnalysisSettings,
  getLinkedFeatureInfo,
  resetExperimentBanditSettings,
  SnapshotAnalysisParams,
  updateExperimentBanditSettings,
  validateExperimentData,
} from "back-end/src/services/experiments";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  generateExperimentEmbeddings,
  getAllExperiments,
  getExperimentById,
  getExperimentByTrackingKey,
  getExperimentByUid,
  getExperimentsByIds,
  getPastExperimentsByDatasource,
  hasArchivedExperiments,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  createVisualChangeset,
  deleteVisualChangesetById,
  findVisualChangesetById,
  findVisualChangesetsByExperiment,
  syncVisualChangesWithVariations,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import {
  deleteSnapshotById,
  findSnapshotById,
  getLatestSnapshot,
  updateSnapshot,
  updateSnapshotsOnPhaseDelete,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  getAISettingsForOrg,
  getContextForAgendaJobByOrgId,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { removeExperimentFromPresentations } from "back-end/src/services/presentations";
import {
  createPastExperiments,
  getPastExperimentsById,
  getPastExperimentsModelByDatasource,
  updatePastExperiments,
} from "back-end/src/models/PastExperimentsModel";
import { IdeaModel } from "back-end/src/models/IdeasModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { generateExperimentNotebook } from "back-end/src/services/notebook";
import { IMPORT_LIMIT_DAYS } from "back-end/src/util/secrets";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { ApiReqContext, PrivateApiErrorResponse } from "back-end/types/api";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { PastExperimentsQueryRunner } from "back-end/src/queryRunners/PastExperimentsQueryRunner";
import {
  createUserVisualEditorApiKey,
  getVisualEditorApiKey,
} from "back-end/src/models/ApiKeyModel";

import {
  getExperimentWatchers,
  upsertWatch,
} from "back-end/src/models/WatchModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { generateExperimentReportSSRData } from "back-end/src/services/reports";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  cosineSimilarity,
  generateEmbeddings,
  secondsUntilAICanBeUsedAgain,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import {
  shouldValidateCustomFieldsOnUpdate,
  validateCustomFieldsForSection,
} from "back-end/src/util/custom-fields";

export const SNAPSHOT_TIMEOUT = 30 * 60 * 1000;

export async function getExperiments(
  req: AuthRequest<
    unknown,
    unknown,
    {
      project?: string;
      includeArchived?: boolean;
      type?: ExperimentType;
    }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const includeArchived = !!req.query?.includeArchived;
  const type: ExperimentType | undefined = req.query?.type || undefined;

  const experiments = await getAllExperiments(context, {
    project,
    includeArchived,
    type,
  });

  const holdouts = await context.models.holdout.getAll();

  const hasArchived = includeArchived
    ? experiments.some((e) => e.archived)
    : await hasArchivedExperiments(context, project);

  res.status(200).json({
    status: 200,
    experiments,
    hasArchived,
    holdouts,
  });
}

/* Post endpoint to use OpenAI library to generate an analysis for a given
experiment based on the id, and the suggested results, winner and releasedVariationId*/
export async function postAIExperimentAnalysis(
  req: AuthRequest<
    {
      results: string;
      winner: number;
      releasedVariationId: string;
      temperature?: number;
    },
    { id: string }
  >,
  res: Response<{
    status: number;
    message?: string;
    retryAfter?: number;
    data?: {
      description: string;
    };
  }>,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const {
    results,
    winner,
    releasedVariationId,
    temperature: reqTemperature,
  } = req.body;
  const temperature = reqTemperature ?? 0.1;

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const phase = experiment.phases.length - 1;
  const snapshot =
    (await getLatestSnapshot({
      experiment: experiment.id,
      phase,
      type: "standard",
    })) || undefined;

  const latestVariations = getLatestPhaseVariations(experiment);
  const winnerVariationName = latestVariations[winner]?.name || "none chosen";
  const releasedVariationName =
    latestVariations.find((v) => v.id === releasedVariationId)?.name || "";

  const allMetricGroups = await context.models.metricGroups.getAll();
  const experimentMetricIds = expandMetricGroups(
    getAllMetricIdsFromExperiment(experiment, false, allMetricGroups),
    allMetricGroups,
  );
  const allOrgMetrics = await getMetricMap(context);
  const experimentMetrics = experimentMetricIds
    .map((id) => allOrgMetrics.get(id))
    .filter(isDefined);

  const instructions =
    "\nYou are an expert data analyst whose colleague has chosen a particular outcome for an A/B test. " +
    "\nYou are fully aware of the experiment framework consisting of:" +
    // Arguments
    "\nThe chosen outcome can be 'dnf' which means 'did not finish', 'won' which means the experiment was successful, 'lost' which means none of the variations were as successful as the control, or 'inconclusive' which means no statistically significant result was detected." +
    "\nIf the chosen outcome is 'dnf', 'inconclusive', or 'lost' then we stick with the control." +
    "\nThe releasedVariationId is the variation that was released as a temporary rollout until the test can be removed from the codebase." +
    "\nUsually the releasedVariationId is the same as the winning variation, but not always perhaps because the difference is not big enough to warrant the cost of maintaining the winning variant, or other external factors not measured by the metrics" +
    // General context
    "\nExperiments are A/B tests that evaluate the performance of different variations of a feature or product." +
    "\nSnapshots are periodic summaries of experiment results, including metrics and statistical analyses." +
    // Experiment structure
    "\nAn Experiment object contains the following key fields:" +
    "\n- id: A unique identifier for the experiment." +
    "\n- name: The name of the experiment." +
    "\n- status: The current status of the experiment (e.g., 'running', 'stopped')." +
    "\n- variations: An array of variations being tested in the experiment. Each variation has an id, name, and description." +
    "\n- phases: An array of phases, where each phase represents a time period during which the experiment was run with specific settings." +
    "\n- results: A summary of the experiment's outcome (e.g., 'won', 'lost', 'inconclusive')." +
    "\n- winner: The index of the winning variation, if applicable." +
    "\n- releasedVariationId: The id of the variation that was released as a result of the experiment." +
    "\n- analysis: A textual summary of the experiment's results and conclusions that you will come up with." +
    "\n- metrics: Metrics are used to evaluate the performance of variations. These include goal metrics, guardrail metrics, and secondary metrics." +
    "\n- linkedFeatures: A list of feature flags or features associated with the experiment." +
    // Snapshot structure
    "\nA Snapshot object contains the following key fields:" +
    "\n- id: A unique identifier for the snapshot." +
    "\n- experiment: The id of the experiment this snapshot belongs to." +
    "\n- phase: The phase index of the experiment this snapshot corresponds to." +
    "\n- status: The status of the snapshot (e.g., 'success', 'running', 'error')." +
    "\n- results: An array of results for each variation in the experiment. Each result includes:" +
    "\n  - name: The name of the variation." +
    "\n  - srm: Sample Ratio Mismatch, a measure of whether traffic was evenly split." +
    "\n  - variations: An array of metrics for each variation. Each metric includes:" +
    "\n    - users: The number of users exposed to the variation." +
    "\n    - metrics: A map of metric ids to their statistical results, including:" +
    "\n      - value: The observed value of the metric." +
    "\n      - cr: Conversion rate for the metric. For metrics with 'revenue' type this is in the local currency, for count it is a number, for duration it is a time, and for binomial it is a percent" +
    "\n      - ci: Confidence interval for the metric." +
    "\n      - uplift: The uplift in performance compared to the baseline." +
    "\n      - chanceToWin: The probability that this variation is better than others." +
    "\n- health: Information about the health of the experiment, including traffic and statistical power." +
    // Metrics and statistical concepts
    "\nMetrics are used to evaluate the performance of variations in an experiment. They include:" +
    "\n- Goal metrics: Metrics that measure the primary objectives of the experiment." +
    "\n- Guardrail metrics: Metrics that ensure the experiment does not negatively impact critical areas." +
    "\n- Secondary metrics: Additional metrics that provide context or insights." +
    "\nStatistical concepts used in experiments include:" +
    "\n- Confidence intervals: A range of values that likely contains the true effect size." +
    "\n- Statistical power: The probability of detecting a true effect." +
    "\n- Sample Ratio Mismatch (SRM): Indicates whether traffic was evenly split among variations." +
    "\n- Chance to Win (bayesian only): The probability that a variation is better than others." +
    "\n- P-Value (frequentist only): The probability that the null hypothesis is true." +
    // Metric types
    "\nMetrics can be of the following types:" +
    "\n- Binomial/Proportion Metrics: Represent yes/no outcomes (e.g., conversion rates). The value is the proportion of users who converted (e.g., 10% means 10 out of 100 users converted)." +
    "\n- Count/Mean Metrics: Represent the total count of events per user (e.g., pages viewed per user). The value is the average count per user." +
    "\n- Duration/Mean Metrics: Represent the total time spent per user (e.g., time on site). The value is the average duration per user, typically in seconds or minutes." +
    "\n- Revenue/Mean Metrics: Represent the total revenue generated per user. The value is in the local currency, and not a percent.  (e.g. For instance 6.58 means the average revenue per user was $6.58 on average)." +
    "\n- Ratio Metrics: Represent the ratio of two numeric values among experiment users." +
    // Statistical results
    "\n- Statistical results for metrics include: Conversion Rate (CR)" +
    "\n- Statistical results for metrics include: Value: Represents the total value of the metric across all users who saw the variation." +
    "\n- Statistical results for metrics include: Confidence Interval (CI): Represents the range within which the true metric value is likely to fall." +
    "\n- Statistical results for metrics include: Uplift: Represents the difference in metric performance between variations (e.g., the increase in average revenue per user for a variation compared to the baseline)." +
    "\n- Statistical results for metrics include: Chance to Win: Represents the probability that a variation is better than others for this metric." +
    // Metric interpretation
    "\n- For binomial metrics, the CR represents the proportion of users who achieved the outcome (e.g., 6.58% means 6.58 out of 100 users converted)." +
    "\n- For count metrics, the CR represents the average number of events per user (e.g., 6.58 means each user performed 6.58 actions on average)." +
    "\n- For duration metrics, the CR represents the average time spent per user (e.g., 6.58 means each user spent 6.58 seconds or minutes on average, depending on the unit)." +
    "\n- For revenue metrics, the CR represents the average revenue per user (e.g., $6.58 means each user generated $6.58 in revenue on average)." +
    // Metric aggregation
    "\nMetrics are aggregated at the user level before being averaged across all users in a variation." +
    "\nFor example, in revenue metrics, the total revenue for all users in a variation is divided by the total number of users in that variation to calculate the average revenue per user." +
    // Relationships between experiments and snapshots
    "\nEach experiment can have multiple snapshots, one for each phase or analysis." +
    "\nSnapshots summarize the results of an experiment at a specific point in time." +
    "\nThe 'results' field in a snapshot provides detailed metrics and statistical analyses for each variation." +
    // Relationships between experiments and metrics
    "\nExperiments are evaluated using metrics, which are categorized into three types:" +
    "\n- Goal metrics: These measure the primary objectives of the experiment and are used to determine success or failure." +
    "\n- Guardrail metrics: These ensure that the experiment does not negatively impact critical areas of the product or business." +
    "\n- Secondary metrics: These provide additional insights or context but are not the primary focus of the experiment." +
    "\nEach metric is identified by a unique ID, which is referenced in the experiment's `goalMetrics`, `guardrailMetrics`, and `secondaryMetrics` fields." +
    "\nThe `experimentMetrics` object is a map where the keys are metric IDs and the values are detailed metric objects. These objects include statistical results and metadata about the metrics." +
    "\nTo evaluate the experiment, the metric IDs in the `goalMetrics`, `guardrailMetrics`, and `secondaryMetrics` fields should be matched to their corresponding metric objects in the `experimentMetrics` map." +
    "\nEach metric object in the `experimentMetrics` map contains the following key fields:" +
    "\n- `value`: The observed value of the metric." +
    "\n- `cr`: The conversion rate for the metric." +
    "\n- `ci`: The confidence interval for the metric." +
    "\n- `uplift`: The uplift in performance compared to the baseline." +
    "\n- `chanceToWin`: The probability that the variation is better than others for this metric." +
    "\n- `pValue`: The p-value for the metric, indicating statistical significance." +
    "\nThe `experimentMetrics` map provides the detailed results for each metric, which are used to analyze the performance of the variations in the experiment." +
    "\nThe keys in the `experimentMetrics` map refer to the ids mentioned in the `goalMetrics`, `guardrailMetrics`, and `secondaryMetrics` fields of the experiment." +
    "\nIf the snapshot is undefined then the experiment probably never started." +
    "\n- the experiment data is: " +
    JSON.stringify(experiment) +
    "\n- the latest snapshot is: " +
    JSON.stringify(snapshot) +
    "\n- the experiment metrics are: " +
    JSON.stringify(experimentMetrics) +
    "\n- Your colleague has chosen the following outcome for the experiment:" +
    results +
    (results === "won"
      ? "\n- the chosen winning variation is: " + winnerVariationName
      : "") +
    "\n- the released variation name is: " +
    releasedVariationName;

  const type = "experiment-analysis";
  const { isDefaultPrompt, prompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt(type);

  const aiResults = await simpleCompletion({
    context,
    instructions,
    prompt: prompt,
    type,
    isDefaultPrompt,
    temperature,
    overrideModel,
  });

  res.status(200).json({
    status: 200,
    data: {
      description: aiResults,
    },
  });
}

export async function postSimilarExperiments(
  req: AuthRequest<{
    hypothesis: string;
    name: string;
    description?: string;
    project?: string;
    full?: boolean;
  }>,
  res: Response<{
    status: number;
    message?: string;
    retryAfter?: number;
    similar?: {
      experiment: ExperimentInterface;
      similarity: number;
    }[];
  }>,
) {
  const context = getContextFromReq(req);
  const { hypothesis, name, description, project, full } = req.body;
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }
  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  // make sure we have enough words in the hypothesis and name for good results:
  const words =
    (hypothesis || "").split(" ").length + (name || "").split(" ").length;
  if (words < 4) {
    return res.status(200).json({
      status: 200,
      message: "Need more words for quality results",
    });
  }
  const previousExperiments: ExperimentInterface[] = await getAllExperiments(
    context,
    {
      project: project ? project : "",
      includeArchived: false,
    },
  );
  // filter to only experiments that have hypothesises, and enough words to make a good search:
  const filteredPreviousExps = previousExperiments.filter((e) => {
    const words =
      (e.hypothesis || "").split(" ").length + (e.name || "").split(" ").length;
    return words >= 4;
  });
  if (filteredPreviousExps.length === 0) {
    return res.status(200).json({
      status: 200,
      message: "No previous experiments found with hypothesis",
    });
  }
  // get Experiment embeddings/vectors.
  const experimentIds = filteredPreviousExps.map((e) => e.id);
  let existingVectors =
    await context.models.vectors.getByExperimentIds(experimentIds);
  // check to see if we need to generate any missing vectors/embeddings:
  if (existingVectors.length !== experimentIds.length) {
    // get the ids of the existing vectors:
    const existingVectorIds = existingVectors.map((v) => v.joinId);
    // check to see if there are any experiments that do not have an entry in the ExperimentVectorsModel, or don't have embeddings:
    const missingVectors = filteredPreviousExps.filter(
      (exp) => !existingVectorIds.includes(exp.id),
    );
    // if there are any missing vectors, we need to generate them:
    if (missingVectors.length > 0) {
      await generateExperimentEmbeddings(context, missingVectors);
      // now fetch the updated vectors:
      existingVectors =
        await context.models.vectors.getByExperimentIds(experimentIds);
    }
  }

  // get the existing vectors that have embeddings with the text to search by:
  const experimentsToSearch = [];
  for (const exp of filteredPreviousExps) {
    // get the existing vector for the experiment:
    const existingVector = existingVectors.find((v) => v.joinId === exp.id);
    if (!existingVector) continue;
    experimentsToSearch.push({
      id: exp.id,
      embeddings: existingVector.embeddings || [],
    });
  }
  // Now we have all the existing experiments with embeddings, we can search for similar experiments
  // Create the text to search by for the new experiment
  const newExperimentText = `Name: ${name}\nHypothesis: ${hypothesis}${
    description && description !== "" ? "\nDescription: " + description : ""
  }
  }`;

  // Generate embeddings for the new experiment
  const newExperimentEmbeddingResponse = await generateEmbeddings({
    context,
    input: [newExperimentText],
  });
  const newEmbedding = newExperimentEmbeddingResponse[0];
  // Call to calculate cosine similarity between the new experiment and existing experiments: cosineSimilarity
  const similarities = experimentsToSearch
    .map((exp) => {
      if (!exp.embeddings) return null;
      const similarity = cosineSimilarity(newEmbedding, exp.embeddings);
      return {
        id: exp.id,
        similarity,
      };
    })
    .filter(isDefined);

  // Sort and filter
  const SIMILARITY_THRESHOLD = full ? 0 : 0.6;
  const similarExperiments = similarities
    .filter((s) => s && s.similarity && s.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => (b?.similarity ?? 0) - (a?.similarity ?? 0))
    .slice(0, full ? 100 : 5); // Get top 5 similar experiments

  // loop through similarExperiments and get the full experiment object
  const similarExperimentObjects = similarExperiments
    .map((s) => previousExperiments.find((e) => e.id === s.id))
    .filter(isDefined);
  const similarExperimentsWithDetails = similarExperiments
    .map((s) => {
      if (!s) return null; // Ensure `s` is not null
      const experiment =
        similarExperimentObjects.find((exp) => exp.id === s.id) || null;
      return experiment ? { experiment, similarity: s.similarity } : null;
    })
    .filter(
      (item): item is { experiment: ExperimentInterface; similarity: number } =>
        item !== null,
    );

  return res.status(200).json({
    status: 200,
    similar: similarExperimentsWithDetails,
  });
}

export async function postRegenerateEmbeddings(
  req: AuthRequest<null, null, { project?: string }>,
  res: ResponseWithStatusAndError<{
    message: string;
  }>,
) {
  const context = getContextFromReq(req);
  const project =
    typeof req.query?.project === "string" ? req.query.project : "";
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }
  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const experiments = await getAllExperiments(context, {
    project,
    includeArchived: true,
  });

  // filter to only experiments that have enough words in the hypothesis and name for good results:
  const filteredExperiments = experiments.filter((e) => {
    const words =
      (e.hypothesis || "").split(" ").length + (e.name || "").split(" ").length;
    return words >= 4;
  });
  await generateExperimentEmbeddings(context, filteredExperiments);

  return res.status(200).json({
    status: 200,
    message: "Embeddings regenerated successfully",
  });
}

export async function getExperimentsFrequencyMonth(
  req: AuthRequest<null, { num: string }, { project?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const allProjects = await context.models.projects.getAll();
  const { num } = req.params;
  const experiments = await getAllExperiments(context, {
    project,
    includeArchived: true,
  });

  const allData: { date: string; numExp: number }[] = [];

  // make the data array with all the months needed and 0 experiments.
  for (let i = parseInt(num) - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1); // necessary because altering the month may result in an invalid date (ex: Feb 31)
    d.setMonth(d.getMonth() - i);
    const ob = {
      date: d.toISOString(),
      numExp: 0,
    };
    allData.push(ob);
  }

  // create stubs for each month by all the statuses:
  const dataByStatus = {
    draft: JSON.parse(JSON.stringify(allData)),
    running: JSON.parse(JSON.stringify(allData)),
    stopped: JSON.parse(JSON.stringify(allData)),
  };

  // create stubs for each month by all the projects:
  const dataByProject: Record<string, [{ date: string; numExp: number }]> = {};
  allProjects.forEach((p) => {
    dataByProject[p.id] = JSON.parse(JSON.stringify(allData));
  });
  dataByProject["all"] = JSON.parse(JSON.stringify(allData));

  // create stubs for each month by all the result:
  const dataByResult = {
    won: JSON.parse(JSON.stringify(allData)),
    lost: JSON.parse(JSON.stringify(allData)),
    inconclusive: JSON.parse(JSON.stringify(allData)),
    dnf: JSON.parse(JSON.stringify(allData)),
  };

  // now get the right number of experiments:
  experiments.forEach((e) => {
    let dateStarted: Date | null = null;
    if (e.status === "draft") {
      dateStarted = e.dateCreated;
    } else {
      e.phases.forEach((p) => {
        if (p.dateStarted && (!dateStarted || p.dateStarted < dateStarted))
          dateStarted = p.dateStarted;
      });
    }
    const monthYear = format(getValidDate(dateStarted), "MMM yyy");

    allData.forEach((md, i) => {
      const name = format(getValidDate(md.date), "MMM yyy");
      if (name === monthYear) {
        md.numExp++;
        // I can do this because the indexes will represent the same month
        dataByStatus[e.status][i].numExp++;

        // experiments without a project or with a deleted project
        // are included in the 'all projects'
        if (e.project && dataByProject[e.project]) {
          dataByProject[e.project][i].numExp++;
        } else {
          dataByProject["all"][i].numExp++;
        }

        if (e.results) {
          dataByResult[e.results][i].numExp++;
        }
      }
    });
  });

  res.status(200).json({
    status: 200,
    all: allData,
    byStatus: { ...dataByStatus },
    byProject: { ...dataByProject },
    byResults: { ...dataByResult },
  });
}

export async function lookupExperimentByTrackingKey(
  req: AuthRequest<unknown, unknown, { trackingKey: string }>,
  res: ResponseWithStatusAndError<{ experimentId: string | null }>,
) {
  const context = getContextFromReq(req);
  const { trackingKey } = req.query;

  if (!trackingKey) {
    return res.status(400).json({
      status: 400,
      message: "Tracking key cannot be empty",
    });
  }

  const experiment = await getExperimentByTrackingKey(
    context,
    trackingKey + "",
  );

  return res.status(200).json({
    status: 200,
    experimentId: experiment?.id || null,
  });
}

export async function getExperiment(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  let idea: IdeaInterface | undefined = undefined;
  if (experiment.ideaSource) {
    idea =
      (await IdeaModel.findOne({
        organization: experiment.organization,
        id: experiment.ideaSource,
      })) || undefined;
  }

  const visualChangesets = await findVisualChangesetsByExperiment(
    experiment.id,
    org.id,
  );

  const urlRedirects = await context.models.urlRedirects.findByExperiment(
    experiment.id,
  );

  const linkedFeatureInfo = await getLinkedFeatureInfo(context, experiment);

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  res.status(200).json({
    status: 200,
    experiment,
    visualChangesets,
    urlRedirects,
    linkedFeatures: linkedFeatureInfo,
    envs,
    idea,
  });
}

export async function getExperimentIncrementalRefresh(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }

  const incrementalRefresh =
    await context.models.incrementalRefresh.getByExperimentId(id);

  return res.status(200).json({
    status: 200,
    incrementalRefresh: incrementalRefresh || null,
  });
}

export async function getExperimentPublic(
  req: AuthRequest<null, { uid: string }>,
  res: Response,
) {
  const { uid } = req.params;
  const experiment = await getExperimentByUid(uid);
  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }
  if (experiment.shareLevel !== "public") {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const context = await getContextForAgendaJobByOrgId(experiment.organization);
  const phase = experiment.phases.length - 1;

  const snapshot =
    (await getLatestSnapshot({
      experiment: experiment.id,
      phase,
      type: "standard",
    })) || undefined;

  const visualChangesets = await findVisualChangesetsByExperiment(
    experiment.id,
    experiment.organization,
  );

  const urlRedirects = await context.models.urlRedirects.findByExperiment(
    experiment.id,
  );

  const linkedFeatures = await getLinkedFeatureInfo(context, experiment);

  const ssrData = await generateExperimentReportSSRData({
    context,
    organization: experiment.organization,
    project: experiment.project,
    snapshot,
  });

  res.status(200).json({
    status: 200,
    experiment,
    snapshot,
    visualChangesets,
    urlRedirects,
    linkedFeatures,
    ssrData,
  });
}

async function _getSnapshot({
  context,
  experiment,
  phase,
  dimension,
  withResults = true,
  type,
}: {
  context: ReqContext | ApiReqContext;
  experiment: string;
  phase?: string;
  dimension?: string;
  withResults?: boolean;
  type?: SnapshotType;
}) {
  const experimentObj = await getExperimentById(context, experiment);

  if (!experimentObj) {
    throw new Error("Experiment not found");
  }

  if (experimentObj.organization !== context.org.id) {
    throw new Error("You do not have access to view this experiment");
  }

  if (!phase) {
    // get the latest phase:
    phase = String(experimentObj.phases.length - 1);
  }

  return await getLatestSnapshot({
    experiment: experimentObj.id,
    phase: parseInt(phase),
    dimension,
    withResults,
    type,
  });
}

export async function getSnapshotWithDimension(
  req: AuthRequest<
    null,
    { id: string; phase: string; dimension: string },
    { type?: SnapshotType }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, phase, dimension } = req.params;
  const type = req.query?.type || undefined;

  const snapshot = await _getSnapshot({
    context,
    experiment: id,
    phase,
    dimension,
    type,
  });
  const latest = await _getSnapshot({
    context,
    experiment: id,
    phase,
    dimension,
    withResults: false,
    type,
  });
  const dimensionless =
    snapshot?.dimension === ""
      ? snapshot
      : await _getSnapshot({
          context,
          experiment: id,
          phase,
          type,
        });

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
    dimensionless,
  });
}
export async function getSnapshot(
  req: AuthRequest<
    null,
    { id: string; phase: string },
    { type?: SnapshotType }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, phase } = req.params;
  const type = req.query?.type || undefined;

  const snapshot = await _getSnapshot({ context, experiment: id, phase, type });
  const latest = await _getSnapshot({
    context,
    experiment: id,
    phase,
    withResults: false,
    type,
  });

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
}

export async function getSnapshotById(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;

  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }

  res.status(200).json({
    status: 200,
    snapshot,
  });
}

export async function postSnapshotNotebook(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const notebook = await generateExperimentNotebook(context, id);

  res.status(200).json({
    status: 200,
    notebook,
  });
}

export async function getSnapshots(
  req: AuthRequest<unknown, unknown, { experiments?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const idsString = (req.query?.experiments as string) || "";
  if (!idsString.length) {
    res.status(200).json({
      status: 200,
      snapshots: [],
    });
    return;
  }

  const ids = idsString.split(",");
  const experimentObjs = await getExperimentsByIds(context, ids);
  const snapshots = await _getSnapshots(context, experimentObjs);

  res.status(200).json({
    status: 200,
    snapshots: snapshots,
  });
  return;
}

export function validateVariationIds(variations: Variation[]) {
  variations.forEach((variation, i) => {
    if (!variation.id) {
      variation.id = uniqid("var_");
    }
    if (!variation.key) {
      variation.key = i + "";
    }
  });
  const keys = variations.map((v) => v.key);
  if (keys.length !== new Set(keys).size) {
    throw new Error("Variation keys must be unique");
  }
}

/**
 * Creates a new experiment
 * If based on another experiment (originalId), it will copy the visual changesets
 * @param req
 * @param res
 */
export async function postExperiments(
  req: AuthRequest<
    Partial<ExperimentInterfaceStringDates>,
    unknown,
    {
      allowDuplicateTrackingKey?: boolean;
      originalId?: string;
      autoRefreshResults?: boolean;
    }
  >,
  res: Response<
    | { status: 200; experiment: ExperimentInterface }
    | { status: 200; duplicateTrackingKey: boolean; existingId: string }
    | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;

  const data = req.body;
  data.organization = org.id;

  if (!context.permissions.canCreateExperiment(data)) {
    context.permissions.throwPermissionError();
  }

  let result:
    | {
        metricIds: string[];
        datasource: DataSourceInterface | null;
        invalidMetricIds: string[];
      }
    | undefined;

  try {
    await validateCustomFieldsForSection({
      customFieldValues: data.customFields,
      customFieldsModel: context.models.customFields,
      section: "experiment",
      project: data.project,
    });

    result = await validateExperimentData(context, data);
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
    return;
  }

  const { metricIds, datasource, invalidMetricIds } = result;

  const experimentType = data.type ?? "standard";
  const holdoutId = data.holdoutId;

  // TODO: Added as a hotfix. Remove when issue #5316 is fixed.
  // Filter out invalid metric ids from the data
  if (invalidMetricIds.length) {
    data.goalMetrics = data.goalMetrics?.filter(
      (id) => !invalidMetricIds.includes(id),
    );
    data.secondaryMetrics = data.secondaryMetrics?.filter(
      (id) => !invalidMetricIds.includes(id),
    );
    data.guardrailMetrics = data.guardrailMetrics?.filter(
      (id) => !invalidMetricIds.includes(id),
    );
    if (
      data.activationMetric &&
      invalidMetricIds.includes(data.activationMetric)
    ) {
      data.activationMetric = "";
    }
  }

  const obj: Omit<ExperimentInterface, "id" | "uid"> = {
    organization: data.organization,
    archived: false,
    hashAttribute: data.hashAttribute || "",
    fallbackAttribute: data.fallbackAttribute || "",
    hashVersion: data.hashVersion || 2,
    disableStickyBucketing: data.disableStickyBucketing ?? false,
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    project: data.project,
    owner: data.owner || userId,
    trackingKey: data.trackingKey || "",
    datasource: data.datasource || "",
    exposureQueryId: data.exposureQueryId || "",
    userIdType: data.userIdType || "anonymous",
    name: data.name || "",
    phases: data.phases
      ? data.phases.map(({ dateStarted, dateEnded, ...phase }) => {
          return {
            ...phase,
            dateStarted: dateStarted ? getValidDate(dateStarted) : new Date(),
            dateEnded: dateEnded ? getValidDate(dateEnded) : undefined,
          };
        })
      : [createInitialPhase({})],
    tags: data.tags || [],
    description: data.description || "",
    hypothesis: data.hypothesis || "",
    goalMetrics: data.goalMetrics || [],
    secondaryMetrics: data.secondaryMetrics || [],
    guardrailMetrics: data.guardrailMetrics || [],
    activationMetric: data.activationMetric || "",
    metricOverrides: data.metricOverrides || [],
    segment: data.segment || "",
    queryFilter: data.queryFilter || "",
    skipPartialData: !!data.skipPartialData,
    attributionModel: data.attributionModel || "firstExposure",
    implementation: data.implementation || "code",
    status: data.status || "draft",
    results: data.results || undefined,
    analysis: data.analysis || "",
    releasedVariationId: "",
    excludeFromPayload: true,
    autoAssign: data.autoAssign || false,
    previewURL: data.previewURL || "",
    targetURLRegex: data.targetURLRegex || "",
    ideaSource: data.ideaSource || "",
    // todo: revisit this logic for project level settings, as well as "override stats settings" toggle:
    sequentialTestingEnabled:
      experimentType === "multi-armed-bandit"
        ? false
        : (data.sequentialTestingEnabled ??
          !!org?.settings?.sequentialTestingEnabled),
    sequentialTestingTuningParameter:
      data.sequentialTestingTuningParameter ??
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled: data.regressionAdjustmentEnabled ?? undefined,
    statsEngine:
      experimentType === "multi-armed-bandit" ? "bayesian" : data.statsEngine,
    type: experimentType,
    banditScheduleValue: data.banditScheduleValue ?? 1,
    banditScheduleUnit: data.banditScheduleUnit ?? "days",
    banditBurnInValue: data.banditBurnInValue ?? 1,
    banditBurnInUnit: data.banditBurnInUnit ?? "days",
    customFields: data.customFields || undefined,
    templateId: data.templateId || undefined,
    shareLevel: data.shareLevel || "organization",
    decisionFrameworkSettings: data.decisionFrameworkSettings || {},
    holdoutId: holdoutId || undefined,
    customMetricSlices: data.customMetricSlices,
  };
  const { settings } = getScopedSettings({
    organization: org,
  });

  // Validate attributionModel + lookbackOverride consistency
  if (obj.attributionModel === "lookbackOverride" && !obj.lookbackOverride) {
    return res.status(400).json({
      status: 400,
      message:
        "lookbackOverride is required when attributionModel is 'lookbackOverride'",
    });
  }

  try {
    obj.phases.forEach((phase) => {
      validateVariationIds(phase.variations);
    });

    // Make sure id is unique
    if (obj.trackingKey && !req.query.allowDuplicateTrackingKey) {
      const existing = await getExperimentByTrackingKey(
        context,
        obj.trackingKey,
      );
      if (existing) {
        return res.status(200).json({
          status: 200,
          duplicateTrackingKey: true,
          existingId: existing.id,
        });
      }
    }

    if (experimentType === "multi-armed-bandit") {
      Object.assign(
        obj,
        resetExperimentBanditSettings({
          experiment: obj,
          settings,
        }),
      );
    }

    const experiment = await createExperiment({
      data: obj,
      context,
    });

    if (holdoutId) {
      const holdoutObj = await context.models.holdout.getById(holdoutId);
      if (!holdoutObj) {
        throw new Error("Holdout not found");
      }
      await context.models.holdout.updateById(holdoutId, {
        linkedExperiments: {
          ...holdoutObj.linkedExperiments,
          [experiment.id]: { id: experiment.id, dateAdded: new Date() },
        },
      });
    }

    if (req.query.originalId) {
      const visualChangesets = await findVisualChangesetsByExperiment(
        req.query.originalId,
        org.id,
      );
      for (const visualChangeset of visualChangesets) {
        await createVisualChangeset({
          experiment,
          urlPatterns: visualChangeset.urlPatterns,
          editorUrl: visualChangeset.editorUrl,
          context,
          visualChanges: visualChangeset.visualChanges,
        });
      }

      const urlRedirects = await context.models.urlRedirects.findByExperiment(
        req.query.originalId,
      );
      for (const urlRedirect of urlRedirects) {
        const props: CreateURLRedirectProps = {
          experiment: experiment.id,
          destinationURLs: urlRedirect.destinationURLs,
          persistQueryString: urlRedirect.persistQueryString,
          urlPattern: urlRedirect.urlPattern,
        };
        await context.models.urlRedirects.create(props);
      }
    }

    if (datasource && req.query.autoRefreshResults && metricIds.length > 0) {
      // This is doing an expensive analytics SQL query, so may take a long time
      // Set timeout to 30 minutes
      req.setTimeout(SNAPSHOT_TIMEOUT);

      try {
        await createExperimentSnapshot({
          context,
          experiment,
          datasource,
          dimension: "",
          phase: 0,
          useCache: true,
        });
      } catch (e) {
        logger.error(e, "Failed to auto-refresh imported experiment");
      }
    }

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate(experiment),
    });

    await upsertWatch({
      userId,
      organization: org.id,
      item: experiment.id,
      type: "experiments",
    });

    res.status(200).json({
      status: 200,
      experiment,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

/**
 * Update an experiment
 * @param req
 * @param res
 */
export async function postExperiment(
  req: AuthRequest<
    ExperimentInterfaceStringDates & {
      currentPhase?: number;
      phaseStartDate?: string;
      phaseEndDate?: string;
      variationWeights?: number[];
    },
    { id: string }
  >,
  res: Response<
    | { status: number; experiment?: ExperimentInterface | null }
    | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id } = req.params;
  const { phaseStartDate, phaseEndDate, currentPhase, ...data } = req.body;

  const experiment = await getExperimentById(context, id);
  const aiSettings = getAISettingsForOrg(context);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, req.body)) {
    context.permissions.throwPermissionError();
  }

  // FIXME: We skip validation because project is updated in a different place than where
  // we define custom fields, and that would prevent the user from doing either update.
  // Ideally we validate custom fields everytime, but we need to update our UI to support that.
  if (
    shouldValidateCustomFieldsOnUpdate({
      existingCustomFieldValues: experiment.customFields,
      updatedCustomFieldValues: data.customFields,
    })
  ) {
    await validateCustomFieldsForSection({
      customFieldValues: data.customFields,
      customFieldsModel: context.models.customFields,
      section: "experiment",
      project: "project" in data ? data.project : experiment.project,
    });
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  let datasourceId: string = experiment.datasource;

  if (data.datasource) {
    datasourceId = data.datasource;
    const datasource = await getDataSourceById(context, data.datasource);
    if (!datasource) {
      res.status(403).json({
        status: 403,
        message: "Invalid datasource: " + data.datasource,
      });
      return;
    }
  }
  // Validate that specified metrics exist and belong to the organization
  const allMetricGroups = await context.models.metricGroups.getAll();
  const oldMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    false,
    allMetricGroups,
  );
  const newMetricIds = getAllMetricIdsFromExperiment(
    data,
    false,
    allMetricGroups,
  ).filter((m) => !oldMetricIds.includes(m));

  const metricMap = await getMetricMap(context);

  const invalidMetricIds: string[] = [];

  if (newMetricIds.length) {
    for (let i = 0; i < newMetricIds.length; i++) {
      const metric = metricMap.get(newMetricIds[i]);
      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (datasourceId && metric.datasource !== datasourceId) {
          res.status(400).json({
            status: 400,
            message:
              "Metrics must be tied to the same datasource as the experiment: " +
              newMetricIds[i],
          });
          return;
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await context.models.metricGroups.getById(
          newMetricIds[i],
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (metricGroup.datasource !== datasourceId) {
            res.status(400).json({
              status: 400,
              message:
                "Metric group must be tied to the same datasource as the experiment: " +
                newMetricIds[i],
            });
            return;
          }
        } else {
          // new metric that's not recognized...
          invalidMetricIds.push(newMetricIds[i]);
          // TODO: Commented out as a hotfix. Remove when issue #5316 is fixed.
          // res.status(403).json({
          //   status: 403,
          //   message: "Unknown metric: " + newMetricIds[i],
          // });
          // return;
        }
      }
    }

    // TODO: Added as a hotfix. Remove when issue #5316 is fixed.
    // Filter out invalid metric ids from the data
    if (invalidMetricIds.length) {
      data.goalMetrics = data.goalMetrics?.filter(
        (id) => !invalidMetricIds.includes(id),
      );
      data.secondaryMetrics = data.secondaryMetrics?.filter(
        (id) => !invalidMetricIds.includes(id),
      );
      data.guardrailMetrics = data.guardrailMetrics?.filter(
        (id) => !invalidMetricIds.includes(id),
      );
      if (
        data.activationMetric &&
        invalidMetricIds.includes(data.activationMetric)
      ) {
        data.activationMetric = "";
      }
    }
  }

  if (data.phases) {
    data.phases.forEach((phase) => {
      if (phase.variations) {
        validateVariationIds(phase.variations);
      }
    });
  }

  if (
    data.holdoutId &&
    data.holdoutId !== experiment.holdoutId &&
    experiment.holdoutId
  ) {
    if (
      experiment.status !== "draft" ||
      experiment.hasURLRedirects ||
      experiment.hasVisualChangesets ||
      (experiment.linkedFeatures && experiment.linkedFeatures.length > 0)
    ) {
      throw new Error(
        "Cannot change holdout after experiment has been run or linked changes have been added",
      );
    }
    await context.models.holdout.removeExperimentFromHoldout(
      experiment.holdoutId,
      experiment.id,
    );
  }

  if (data.holdoutId && data.holdoutId !== experiment.holdoutId) {
    const holdoutObj = await context.models.holdout.getById(data.holdoutId);
    if (!holdoutObj) {
      throw new Error("Holdout not found");
    }
    await context.models.holdout.updateById(data.holdoutId, {
      linkedExperiments: {
        ...holdoutObj.linkedExperiments,
        [experiment.id]: { id: experiment.id, dateAdded: new Date() },
      },
    });
  }

  if (data.defaultDashboardId) {
    const dashboard = await context.models.dashboards.getById(
      data.defaultDashboardId,
    );
    if (!dashboard) {
      res.status(403).json({
        status: 403,
        message: "Invalid dashboard: " + data.defaultDashboardId,
      });
      return;
    }
  }

  const keys: (keyof ExperimentInterface)[] = [
    "trackingKey",
    "owner",
    "datasource",
    "exposureQueryId",
    "userIdType",
    "hashAttribute",
    "fallbackAttribute",
    "disableStickyBucketing",
    "hashVersion",
    "name",
    "tags",
    "description",
    "hypothesis",
    "activationMetric",
    "segment",
    "queryFilter",
    "skipPartialData",
    "attributionModel",
    "goalMetrics",
    "secondaryMetrics",
    "guardrailMetrics",
    "metricOverrides",
    "lookbackOverride",
    "decisionFrameworkSettings",
    "status",
    "results",
    "analysis",
    "winner",
    "implementation",
    "autoAssign",
    "previewURL",
    "targetURLRegex",
    "releasedVariationId",
    "excludeFromPayload",
    "autoSnapshots",
    "project",
    "regressionAdjustmentEnabled",
    "postStratificationEnabled",
    "hasVisualChangesets",
    "hasURLRedirects",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
    "statsEngine",
    "type",
    "banditStage",
    "banditScheduleValue",
    "banditScheduleUnit",
    "banditBurnInValue",
    "banditBurnInUnit",
    "customFields",
    "shareLevel",
    "uid",
    "analysisSummary",
    "dismissedWarnings",
    "holdoutId",
    "defaultDashboardId",
    "customMetricSlices",
  ];
  let changes: Changeset = {};

  keys.forEach((key) => {
    if (!(key in data)) {
      return;
    }

    // Do a deep comparison for arrays, shallow for everything else
    let hasChanges = data[key] !== experiment[key];
    if (
      key === "goalMetrics" ||
      key === "secondaryMetrics" ||
      key === "guardrailMetrics" ||
      key === "metricOverrides" ||
      key === "lookbackOverride" ||
      key === "customFields" ||
      key === "customMetricSlices"
    ) {
      hasChanges =
        JSON.stringify(data[key]) !== JSON.stringify(experiment[key]);
    }

    if (hasChanges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (changes as any)[key] = data[key];
    }
  });

  // Coerce lookbackOverride date value when type is "date"
  if (changes.lookbackOverride?.type === "date") {
    changes.lookbackOverride = {
      type: "date",
      value: getValidDate(changes.lookbackOverride.value),
    };
  }

  // Validate attributionModel + lookbackOverride consistency
  {
    const effectiveAttrModel =
      changes.attributionModel ?? experiment.attributionModel;
    const effectiveLookback =
      "lookbackOverride" in changes
        ? changes.lookbackOverride
        : experiment.lookbackOverride;
    if (effectiveAttrModel === "lookbackOverride" && !effectiveLookback) {
      res.status(400).json({
        status: 400,
        message:
          "lookbackOverride is required when attributionModel is 'lookbackOverride'",
      });
      return;
    }
  }

  // If changing phase start/end dates (from "Configure Analysis" modal)
  if (
    experiment.status !== "draft" &&
    currentPhase !== undefined &&
    experiment.phases?.[currentPhase] &&
    (phaseStartDate || phaseEndDate)
  ) {
    const phases = [...experiment.phases];
    const phaseClone = { ...phases[currentPhase] };
    phases[Math.floor(currentPhase * 1)] = phaseClone;
    const firstPhaseClone = { ...phases[0] };

    if (phaseStartDate) {
      phaseClone.dateStarted = getValidDate(phaseStartDate + ":00Z");
    }
    if (experiment.status === "stopped" && phaseEndDate) {
      phaseClone.dateEnded = getValidDate(phaseEndDate + ":00Z");
      // update both phases when stopped
      if (experiment.type === "holdout") {
        firstPhaseClone.dateEnded = getValidDate(phaseEndDate + ":00Z");
        phases[0] = firstPhaseClone; // update the first phase to the same date ended
      }
    }
    changes.phases = phases;
  }

  // Clean up some vars for bandits, but only if safe to do so...
  // If it's a draft, hasn't been run as a bandit before, and is/will be a MAB:
  if (
    experiment.status === "draft" &&
    experiment.banditStage === undefined &&
    ((data.type === undefined && experiment.type === "multi-armed-bandit") ||
      data.type === "multi-armed-bandit")
  ) {
    changes = resetExperimentBanditSettings({
      experiment,
      metricMap,
      changes,
      settings,
    });
  }
  // If it's already a bandit and..
  if (experiment.type === "multi-armed-bandit") {
    // ...the schedule has changed, recompute next run
    if (
      changes.banditScheduleUnit !== undefined ||
      changes.banditScheduleValue !== undefined ||
      changes.banditBurnInUnit !== undefined ||
      changes.banditBurnInValue !== undefined
    ) {
      changes.nextSnapshotAttempt = determineNextBanditSchedule({
        ...experiment,
        ...changes,
      } as ExperimentInterface);
    }
  }

  if (data.variationWeights) {
    const phases = [...experiment.phases];
    const lastIndex = phases.length - 1;
    phases[lastIndex] = {
      ...phases[lastIndex],
      variationWeights: data.variationWeights,
    };
    changes.phases = phases;
  }

  // Only some fields affect production SDK payloads
  const needsRunExperimentsPermission = (
    [
      "phases",
      "project",
      "name",
      "trackingKey",
      "archived",
      "status",
      "releasedVariationId",
      "excludeFromPayload",
      "type",
      "banditStage",
      "banditStageDateStarted",
      "banditScheduleValue",
      "banditScheduleUnit",
      "banditBurnInValue",
      "banditBurnInUnit",
    ] as (keyof ExperimentInterfaceStringDates)[]
  ).some((key) => key in changes);
  if (needsRunExperimentsPermission) {
    const linkedFeatureIds = experiment.linkedFeatures || [];

    const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: context.org.settings?.environments || [],
      linkedFeatures,
    });
    if (envs.length > 0) {
      const projects = [experiment.project || undefined];
      if ("project" in changes) {
        projects.push(changes.project || undefined);
      }
      // check user's permission on existing experiment project and the updated project, if changed
      projects.forEach((project) => {
        if (!context.permissions.canRunExperiment({ project }, envs)) {
          context.permissions.throwPermissionError();
        }
      });
    }
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  // if phases (which contain variations) have changed, update the experiment's visualchangesets if they exist
  if (changes.phases && updated) {
    const visualChangesets = await findVisualChangesetsByExperiment(
      experiment.id,
      org.id,
    );

    if (visualChangesets.length) {
      await Promise.all(
        visualChangesets.map((vc) =>
          syncVisualChangesWithVariations({
            visualChangeset: vc,
            experiment: updated,
            context,
          }),
        ),
      );
    }

    const urlRedirects = await context.models.urlRedirects.findByExperiment(
      experiment.id,
    );
    if (urlRedirects.length) {
      await Promise.all(
        urlRedirects.map((urlRedirect) =>
          context.models.urlRedirects.syncURLRedirectsWithVariations(
            urlRedirect,
            updated,
          ),
        ),
      );
    }
  }
  if (
    aiSettings.aiEnabled &&
    (changes.name || changes.description || changes.hypothesis)
  ) {
    // If name, description or hypothesis changed, update the vectors:
    await generateExperimentEmbeddings(context, [updated]);
  }

  await req.audit({
    event: "experiment.update",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  // If there are new tags to add
  await addTagsDiff(org.id, experiment.tags || [], data.tags || []);

  await upsertWatch({
    userId,
    organization: org.id,
    item: experiment.id,
    type: "experiments",
  });

  res.status(200).json({
    status: 200,
    experiment: updated,
  });
}

export async function postExperimentArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

  const changes: Changeset = {};

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });
  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  changes.archived = true;

  try {
    await updateExperiment({
      context,
      experiment,
      changes,
    });

    // TODO: audit
    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "experiment.archive",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to archive experiment",
    });
  }
}

export async function postExperimentUnarchive(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);
  const changes: Changeset = {};

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  changes.archived = false;

  try {
    await updateExperiment({
      context,
      experiment,
      changes,
    });

    // TODO: audit
    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "experiment.unarchive",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to unarchive experiment",
    });
  }
}

export async function postExperimentStatus(
  req: AuthRequest<
    {
      status: ExperimentStatus;
      reason: string;
      dateEnded: string;
    },
    { id: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { status, reason, dateEnded } = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    throw new Error("Experiment not found");
  }
  if (experiment.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }
  if (experiment.type === "holdout") {
    res.status(400).json({
      status: 400,
      message:
        "Cannot edit the status of a holdout through this endpoint. Use the /holdout/:id/edit-status endpoint instead.",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  // If status changed from running to stopped, update the latest phase
  const phases = [...experiment.phases];
  const lastIndex = phases.length - 1;
  if (
    experiment.status === "running" &&
    status === "stopped" &&
    phases?.length > 0 &&
    !phases[lastIndex].dateEnded
  ) {
    phases[lastIndex] = {
      ...phases[lastIndex],
      reason,
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
    };
    changes.phases = phases;
  }
  // Starting an experiment from draft
  else if (
    experiment.status === "draft" &&
    status === "running" &&
    phases?.length > 0
  ) {
    const additionalChanges: Changeset = await getChangesToStartExperiment(
      context,
      experiment,
    );
    Object.assign(changes, additionalChanges);
  }
  // If starting or drafting a stopped experiment, clear the phase end date
  // and perform any needed bandit cleanup
  else if (
    experiment.status === "stopped" &&
    (status === "running" || status === "draft") &&
    phases?.length > 0
  ) {
    const clonedPhase = { ...phases[lastIndex] };

    delete clonedPhase.dateEnded;
    phases[lastIndex] = clonedPhase;

    changes.phases = phases;

    // Bandit-specific changes
    if (experiment.type === "multi-armed-bandit") {
      // We must create a new phase. No continuing old phases allowed
      // If we had a previous phase, mark it as ended
      if (phases.length) {
        phases[phases.length - 1].dateEnded = new Date();
      }

      phases.push({
        condition: clonedPhase.condition,
        savedGroups: clonedPhase.savedGroups,
        prerequisites: clonedPhase.prerequisites,
        coverage: clonedPhase.coverage,
        dateStarted: new Date(),
        name: "Main",
        namespace: clonedPhase.namespace,
        reason: "",
        variationWeights: clonedPhase.variationWeights,
        variations: clonedPhase.variations,
        seed: uuidv4(),
      });

      // flush the sticky existing buckets
      changes.bucketVersion = (experiment.bucketVersion ?? 0) + 1;
      changes.minBucketVersion = (experiment.bucketVersion ?? 0) + 1;

      Object.assign(
        changes,
        resetExperimentBanditSettings({
          experiment,
          changes,
          settings,
        }),
      );
    }
  }

  changes.status = status;

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.status",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postExperimentStop(
  req: AuthRequest<
    { reason: string; dateEnded: string } & Partial<ExperimentInterface>,
    { id: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const {
    reason,
    results,
    analysis,
    winner,
    dateEnded,
    releasedVariationId,
    excludeFromPayload,
  } = req.body;

  const experiment = await getExperimentById(context, id);
  const changes: Changeset = {};

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (experiment.type === "holdout") {
    res.status(400).json({
      status: 400,
      message:
        "Cannot stop a holdout through this endpoint. Use the /holdout/:id/edit-status endpoint instead.",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, req.body)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const phases = [...experiment.phases];
  // Already has phases
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
      coverage: !excludeFromPayload ? 1 : phases[phases.length - 1].coverage,
      reason,
    };
    changes.phases = phases;
  }

  // Make sure experiment is stopped
  let isEnding = false;
  if (experiment.status === "running") {
    changes.status = "stopped";
    isEnding = true;
  }

  // TODO: validation
  changes.winner = winner;
  changes.results = results;
  changes.analysis = analysis;
  changes.releasedVariationId = releasedVariationId;
  changes.excludeFromPayload = !!excludeFromPayload;
  if (experiment.type == "multi-armed-bandit") {
    // pause bandit stage
    changes.banditStage = "paused";
    changes.banditStageDateStarted = new Date();
  }

  try {
    const updated = await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: isEnding ? "experiment.stop" : "experiment.results",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to stop experiment",
    });
  }
}

export async function deleteExperimentPhase(
  req: AuthRequest<null, { id: string; phase: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, phase } = req.params;
  const phaseIndex = parseInt(phase);

  const experiment = await getExperimentById(context, id);
  const changes: Changeset = {};

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  if (experiment.phases.length === 1) {
    res.status(400).json({
      status: 400,
      message: "Cannot delete the only phase",
    });
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  if (phaseIndex < 0 || phaseIndex >= experiment.phases?.length) {
    throw new Error("Invalid phase id");
  }

  // Remove an element from an array without mutating the original
  changes.phases = experiment.phases.filter((phase, i) => i !== phaseIndex);

  if (!changes.phases.length) {
    changes.status = "draft";
    if (experiment.type === "multi-armed-bandit") {
      changes.banditStage = "paused";
    }
  }
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  await updateSnapshotsOnPhaseDelete(org.id, id, phaseIndex);

  // Add audit entry
  await req.audit({
    event: "experiment.phase.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function putExperimentPhase(
  req: AuthRequest<ExperimentPhase, { id: string; phase: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const i = parseInt(req.params.phase);
  const phase = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  if (!experiment.phases?.[i]) {
    throw new Error("Invalid phase");
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  phase.dateStarted = phase.dateStarted
    ? getValidDate(phase.dateStarted + ":00Z")
    : new Date();
  phase.dateEnded = phase.dateEnded
    ? getValidDate(phase.dateEnded + ":00Z")
    : undefined;

  const phases = [...experiment.phases];
  phases[i] = {
    ...phases[i],
    ...phase,
  };
  changes.phases = phases;

  if (experiment.type === "multi-armed-bandit") {
    Object.assign(
      changes,
      resetExperimentBanditSettings({
        experiment,
        changes,
        settings,
      }),
    );
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.phase",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postExperimentTargeting(
  req: AuthRequest<ExperimentTargetingData, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id } = req.params;

  const {
    condition,
    savedGroups,
    prerequisites,
    coverage,
    hashAttribute,
    fallbackAttribute,
    hashVersion,
    disableStickyBucketing,
    bucketVersion,
    minBucketVersion,
    namespace,
    trackingKey,
    variationWeights,
    seed,
    newPhase,
    reseed,
  } = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const phases = [...experiment.phases];

  // Already has phases and we're updating an existing phase
  if (phases.length && !newPhase) {
    if (experiment.type !== "holdout") {
      phases[phases.length - 1] = {
        ...phases[phases.length - 1],
        condition,
        savedGroups,
        prerequisites,
        coverage,
        namespace,
        variationWeights,
        seed,
      };
    } else {
      phases[phases.length - 1] = {
        ...phases[phases.length - 1],
        condition,
        savedGroups,
        coverage,
      };
    }
  } else if (phases.length) {
    const lastPhase = phases[phases.length - 1];
    // If we had a previous phase, mark it as ended
    lastPhase.dateEnded = new Date();

    // Variation weights must come with variations or match the number of variations in the last phase
    // No way to update variations right now, so just assert that the number of variations matches
    if (variationWeights.length !== lastPhase.variations.length) {
      res.status(400).json({
        status: 400,
        message:
          "Length of variation weights must match the number of variations",
      });
      return;
    }

    phases.push({
      condition,
      savedGroups,
      prerequisites,
      coverage,
      dateStarted: new Date(),
      name: "Main",
      namespace,
      reason: "",
      variationWeights: variationWeights,
      variations: lastPhase.variations,
      seed: phases.length && reseed ? uuidv4() : seed,
    });
  } else {
    // If somehow this endpoint is creating the first phase,
    // pick reasonable values
    phases.push(
      createInitialPhase({
        condition,
        savedGroups,
        prerequisites,
        coverage,
        namespace,
        variationWeights,
      }),
    );
  }
  changes.phases = phases;

  if (experiment.type === "multi-armed-bandit") {
    Object.assign(
      changes,
      resetExperimentBanditSettings({
        experiment,
        changes,
        settings,
      }),
    );
  }

  changes.hashAttribute = hashAttribute;
  if (experiment.type !== "holdout") {
    changes.fallbackAttribute = fallbackAttribute;
    changes.hashVersion = hashVersion;
    changes.disableStickyBucketing = disableStickyBucketing;
    changes.bucketVersion = bucketVersion;
    changes.minBucketVersion = minBucketVersion;
    if (trackingKey) changes.trackingKey = trackingKey;
  }

  // TODO: validation
  try {
    const updated = await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: "experiment.update",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    await upsertWatch({
      userId,
      organization: org.id,
      item: experiment.id,
      type: "experiments",
    });

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to edit experiment targeting",
    });
  }
}

export async function postExperimentPhase(
  req: AuthRequest<ExperimentPhase, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id } = req.params;
  const { reason, dateStarted, ...data } = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const date = dateStarted ? getValidDate(dateStarted + ":00Z") : new Date();

  const phases = [...experiment.phases];
  // Already has phases - snapshot last phase's variations and end it
  if (phases.length) {
    const lastPhaseIndex = phases.length - 1;
    const lastPhase = phases[lastPhaseIndex];
    if (experiment.type === "holdout") {
      phases[0].dateEnded = date;
    }
    phases[lastPhaseIndex] = {
      ...lastPhase,
      dateEnded: date,
      reason,
    };
  }

  // Make sure experiment is running
  let isStarting = false;
  if (experiment.status === "draft") {
    changes.status = "running";
    isStarting = true;
  }

  phases.push({
    ...data,
    dateStarted: date,
    dateEnded: undefined,
    reason: "",
  });

  // TODO: validation
  try {
    changes.phases = phases;
    const updated = await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: isStarting ? "experiment.start" : "experiment.phase",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    await upsertWatch({
      userId,
      organization: org.id,
      item: experiment.id,
      type: "experiments",
    });

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to start new experiment phase",
    });
  }
}

export async function getWatchingUsers(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { id } = req.params;
  const watchers = await getExperimentWatchers(id, org.id);
  res.status(200).json({
    status: 200,
    userIds: watchers,
  });
}

export async function deleteExperiment(
  req: AuthRequest<ExperimentInterface, { id: string }>,
  res: Response<
    { status: 200 } | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canDeleteExperiment(experiment)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const promises = [
    // note: we might want to change this to change the status to
    // 'deleted' instead of actually deleting the document.
    deleteExperimentByIdForOrganization(context, experiment),
    removeExperimentFromPresentations(experiment.id),
  ];

  await Promise.all(promises);

  if (experiment.holdoutId) {
    try {
      await context.models.holdout.removeExperimentFromHoldout(
        experiment.holdoutId,
        experiment.id,
      );
    } catch (e) {
      // This is not a fatal error, so don't block the request from happening
      logger.warn(e, "Error removing experiment from holdout");
    }
  }

  await req.audit({
    event: "experiment.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsDelete(experiment),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function cancelSnapshot(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }

  const experiment = await getExperimentById(context, snapshot.experiment);

  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    snapshot.settings.datasourceId,
  );

  const queryRunner = new ExperimentResultsQueryRunner(
    context,
    snapshot,
    integration,
  );
  await queryRunner.cancelQueries();
  await deleteSnapshotById(org.id, snapshot.id);

  res.status(200).json({ status: 200 });
}

function getSnapshotType({
  experiment,
  dimension,
  phaseIndex,
}: {
  experiment: ExperimentInterface;
  dimension: string | undefined;
  phaseIndex: number;
}): SnapshotType {
  // dimension analyses are ad-hoc
  if (dimension) {
    return "exploratory";
  }

  // analyses of old phases are ad-hoc
  if (phaseIndex !== experiment.phases.length - 1) {
    return "exploratory";
  }

  return "standard";
}

export async function createExperimentSnapshot({
  context,
  experiment,
  datasource,
  dimension,
  phase,
  useCache = true,
  triggeredBy,
  type,
  reweight,
  preventStartingAnalysis,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  dimension: string | undefined;
  phase: number;
  useCache?: boolean;
  triggeredBy?: SnapshotTriggeredBy;
  type?: SnapshotType;
  reweight?: boolean;
  preventStartingAnalysis?: boolean;
}): Promise<{
  snapshot: ExperimentSnapshotInterface;
  queryRunner:
    | ExperimentResultsQueryRunner
    | ExperimentIncrementalRefreshQueryRunner
    | ExperimentIncrementalRefreshExploratoryQueryRunner;
}> {
  const snapshotType =
    type ??
    getSnapshotType({
      experiment,
      dimension,
      phaseIndex: phase,
    });

  let project = null;
  if (experiment.project) {
    project = await context.models.projects.getById(experiment.project);
  }

  const { org } = context;
  const orgSettings: OrganizationSettings =
    org.settings as OrganizationSettings;
  const { settings } = getScopedSettings({
    organization: org,
    project: project ?? undefined,
    experiment,
  });
  const statsEngine = settings.statsEngine.value;
  const postStratificationEnabled = settings.postStratificationEnabled.value;
  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  const metricGroups = await context.models.metricGroups.getAll();
  const metricIds = getAllMetricIdsFromExperiment(
    experiment,
    false,
    metricGroups,
  );

  const allExperimentMetrics = metricIds.map((m) => metricMap.get(m) || null);

  const denominatorMetricIds = uniq<string>(
    allExperimentMetrics
      .map((m) => m?.denominator)
      .filter((d) => d && typeof d === "string") as string[],
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => metricMap.get(m) || null)
    .filter(isDefined) as MetricInterface[];
  const { settingsForSnapshotMetrics, regressionAdjustmentEnabled } =
    getAllMetricSettingsForSnapshot({
      allExperimentMetrics,
      denominatorMetrics,
      orgSettings,
      experimentRegressionAdjustmentEnabled:
        experiment.regressionAdjustmentEnabled,
      experimentMetricOverrides: experiment.metricOverrides,
      datasourceType: datasource?.type,
      hasRegressionAdjustmentFeature: true,
    });

  const analysisSettings = getDefaultExperimentAnalysisSettings({
    statsEngine,
    experiment,
    organization: org,
    regressionAdjustmentEnabled,
    postStratificationEnabled,
    dimension,
  });

  const queryRunner = await createSnapshot({
    experiment,
    context,
    phaseIndex: phase,
    useCache,
    defaultAnalysisSettings: analysisSettings,
    additionalAnalysisSettings:
      getAdditionalExperimentAnalysisSettings(analysisSettings),
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    reweight,
    type: snapshotType,
    triggeredBy: triggeredBy ?? "manual",
    preventStartingAnalysis,
  });
  const snapshot = queryRunner.model;

  return { snapshot, queryRunner };
}

export async function postSnapshot(
  req: AuthRequest<
    {
      phase: number;
      dimension?: string;
      users?: number[];
      metrics?: { [key: string]: MetricStats[] };
    },
    { id: string },
    { force?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { phase, dimension } = req.body;

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (!experiment.phases[phase]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource for this experiment");
  }

  const useCache = !req.query["force"];

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(SNAPSHOT_TIMEOUT);

  try {
    const { snapshot } = await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      dimension,
      phase,
      useCache,
      type:
        experiment.type === "multi-armed-bandit" ? "exploratory" : undefined,
    });

    await req.audit({
      event: "experiment.refresh",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate({
        phase,
        dimension,
        useCache,
        manual: false,
      }),
    });
    res.status(200).json({
      status: 200,
      snapshot,
    });
  } catch (e) {
    req.log.error(e, "Failed to create experiment snapshot");
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}
export async function postSnapshotAnalysis(
  req: AuthRequest<
    {
      analysisSettings: ExperimentSnapshotAnalysisSettings;
      phaseIndex?: number;
    },
    { id: string }
  >,
  res: Response<{ status: 200 } | PrivateApiErrorResponse>,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;
  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    res.status(404).json({
      status: 404,
      message: "Snapshot not found",
    });
    return;
  }

  const { analysisSettings, phaseIndex } = req.body;

  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (snapshot.settings.coverage === undefined) {
    const latestPhase = experiment.phases.length - 1;
    snapshot.settings.coverage =
      experiment.phases[phaseIndex ?? latestPhase].coverage;
    // JIT migrate snapshots to have
    await updateSnapshot({
      organization: org.id,
      id,
      updates: { settings: snapshot.settings },
      context,
    });
  }

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  const metricGroups = await context.models.metricGroups.getAll();

  // Expand all slice metrics (auto and custom) and add them to the metricMap
  // This ensures slice metrics are available when passed to the stats engine
  expandAllSliceMetricsInMap({
    metricMap,
    factTableMap,
    experiment: experiment,
    metricGroups,
  });

  try {
    await createSnapshotAnalysis(context, {
      experiment: experiment,
      organization: org,
      analysisSettings: analysisSettings,
      metricMap: metricMap,
      snapshot: snapshot,
    });
    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    req.log.error(e, "Failed to create experiment snapshot analysis");
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postBanditSnapshot(
  req: AuthRequest<
    {
      reweight?: boolean;
    },
    { id: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { reweight } = req.body;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const phase = experiment.phases.length - 1;
  if (!experiment.phases[phase]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  if (!experiment.datasource) {
    throw new Error("Could not find datasource for this experiment");
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource for this experiment");
  }

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(30 * 60 * 1000);
  let snapshot: ExperimentSnapshotInterface | undefined = undefined;

  try {
    const { queryRunner } = await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      dimension: "",
      phase,
      useCache: false,
      type: "standard",
      reweight,
    });

    await queryRunner.waitForResults();
    snapshot = queryRunner.model;

    if (!snapshot?.banditResult) {
      return res.status(400).json({
        status: 400,
        message: "Unable to update bandit.",
        snapshot,
      });
    }

    const changes = updateExperimentBanditSettings({
      experiment,
      snapshot,
      reweight,
    });

    await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: "experiment.refresh",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate({
        phase,
        dimension: "",
        useCache: false,
        manual: false,
      }),
    });
    return res.status(200).json({
      status: 200,
      snapshot,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e?.message || e,
      snapshot,
    });
  }
}

function addCoverageToSnapshotIfMissing(
  snapshot: ExperimentSnapshotInterface,
  experiment: ExperimentInterface,
  phase?: number,
): ExperimentSnapshotInterface {
  if (snapshot.settings.coverage === undefined) {
    const latestPhase = experiment.phases.length - 1;
    snapshot.settings.coverage =
      experiment.phases[phase ?? latestPhase]?.coverage ?? 1;
  }
  return snapshot;
}

export async function postSnapshotsWithScaledImpactAnalysis(
  req: AuthRequest<{
    experiments: string[];
  }>,
  res: Response<{ status: 200 } | PrivateApiErrorResponse>,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { experiments } = req.body;
  if (!experiments.length) {
    res.status(200).json({
      status: 200,
    });
    return;
  }
  const metricMap = await getMetricMap(context);
  const experimentObjs = await getExperimentsByIds(context, experiments);

  // get latest snapshot for latest phase without dimensions but with results
  const snapshots = await _getSnapshots(context, experimentObjs);

  // Add snapshots missing scaled analysis to list to fetch
  const snapshotAnalysesToCreate: SnapshotAnalysisParams[] = [];
  snapshots.forEach((s) => {
    const defaultAnalysis = getSnapshotAnalysis(s);
    if (!defaultAnalysis) return;

    const scaledImpactAnalysisSettings: ExperimentSnapshotAnalysisSettings = {
      ...defaultAnalysis.settings,
      differenceType: "scaled",
    };
    if (getSnapshotAnalysis(s, scaledImpactAnalysisSettings)) return;

    const experiment = experimentObjs.find((e) => e.id === s.experiment);
    if (!experiment) return;

    addCoverageToSnapshotIfMissing(s, experiment);

    snapshotAnalysesToCreate.push({
      experiment: experiment,
      organization: org,
      analysisSettings: scaledImpactAnalysisSettings,
      metricMap: metricMap,
      snapshot: s,
    });
  });

  if (snapshotAnalysesToCreate.length > 0) {
    await createSnapshotAnalyses(snapshotAnalysesToCreate, context).catch(
      (e) => {
        req.log.error(e);
      },
    );
  }
  res.status(200).json({
    status: 200,
  });
  return;
}

export async function deleteScreenshot(
  req: AuthRequest<{ url: string }, { id: string; variation: number }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, variation } = req.params;
  const { url } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const latestPhaseIndex = experiment.phases.length - 1;
  const originalVariation =
    experiment.phases[latestPhaseIndex]?.variations[variation];
  if (!originalVariation) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

  const phases = cloneDeep(experiment.phases);
  const updatedVariation = phases[latestPhaseIndex].variations[variation];

  // TODO: delete from s3 as well? Should not do if the screenshot exists in
  // old phases
  updatedVariation.screenshots = updatedVariation.screenshots.filter(
    (s) => s.path !== url,
  );
  changes.phases = phases;
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.screenshot.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(
      originalVariation.screenshots,
      updated?.phases[latestPhaseIndex]?.variations[variation]?.screenshots ||
        [],
      { variation },
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

type AddScreenshotRequestBody = {
  url: string;
  description?: string;
};
export async function addScreenshot(
  req: AuthRequest<AddScreenshotRequestBody, { id: string; variation: number }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id, variation } = req.params;
  const { url, description } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const latestPhaseIndex = experiment.phases.length - 1;
  const originalVariation =
    experiment.phases[latestPhaseIndex]?.variations[variation];
  if (!originalVariation) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

  const phases = cloneDeep(experiment.phases);

  phases[latestPhaseIndex].variations[variation].screenshots =
    phases[latestPhaseIndex].variations[variation].screenshots || [];

  phases[latestPhaseIndex].variations[variation].screenshots.push({
    path: url,
    description: description,
  });
  changes.phases = phases;

  await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.screenshot.create",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsCreate({
      variation,
      url,
      description,
    }),
  });

  await upsertWatch({
    userId,
    organization: org.id,
    item: experiment.id,
    type: "experiments",
  });

  res.status(200).json({
    status: 200,
    screenshot: {
      path: url,
      description: description,
    },
  });
}

export async function cancelPastExperiments(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const pastExperiments = await getPastExperimentsById(org.id, id);
  if (!pastExperiments) {
    throw new Error("Could not cancel query");
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    pastExperiments.datasource,
  );

  const queryRunner = new PastExperimentsQueryRunner(
    context,
    pastExperiments,
    integration,
  );
  await queryRunner.cancelQueries();

  res.status(200).json({ status: 200 });
}

export async function getPastExperimentsList(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const pastExperiments = await getPastExperimentsById(org.id, id);

  if (!pastExperiments) {
    throw new Error("Invalid import id");
  }

  const experiments = await getPastExperimentsByDatasource(
    context,
    pastExperiments.datasource,
  );

  const experimentMap = new Map<string, string>();
  (experiments || []).forEach((e) => {
    experimentMap.set(e.trackingKey, e.id);
    experimentMap.set(e.trackingKey + "::" + e.exposureQueryId, e.id);
  });

  const trackingKeyMap: Record<string, string> = {};
  (pastExperiments.experiments || []).forEach((e) => {
    const keys = [e.trackingKey, e.trackingKey + "::" + e.exposureQueryId];
    keys.forEach((key) => {
      const id = experimentMap.get(key);
      if (id) {
        trackingKeyMap[key] = id;
      }
    });
  });

  res.status(200).json({
    status: 200,
    experiments: pastExperiments,
    existing: trackingKeyMap,
    lookbackDays: IMPORT_LIMIT_DAYS,
  });
}

//experiments/import, sent here right after "add experiment"
export async function postPastExperiments(
  req: AuthRequest<{ datasource: string; force: boolean; refresh?: boolean }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { datasource, force, refresh } = req.body;

  const integration = await getIntegrationFromDatasourceId(
    context,
    datasource,
    true,
  );

  let pastExperiments = await getPastExperimentsModelByDatasource(
    org.id,
    datasource,
  );

  const start = new Date();
  start.setDate(start.getDate() - IMPORT_LIMIT_DAYS);

  if (!pastExperiments) {
    pastExperiments = await createPastExperiments({
      organization: org.id,
      datasource,
      experiments: [],
      start,
      queries: [],
    });
  }

  let needsRun = false;
  if (force) {
    needsRun = true;
    pastExperiments = await updatePastExperiments(pastExperiments, {
      config: {
        start:
          !refresh && pastExperiments.config
            ? pastExperiments.config.start
            : start,
        end: new Date(),
      },
    });
  }

  if (needsRun) {
    const queryRunner = new PastExperimentsQueryRunner(
      context,
      pastExperiments,
      integration,
    );
    pastExperiments = await queryRunner.startAnalysis({
      from: start,
      forceRefresh: !!refresh,
    });
  }

  res.status(200).json({
    status: 200,
    id: pastExperiments.id,
  });

  if (needsRun) {
    await req.audit({
      event: "datasource.import",
      entity: {
        object: "datasource",
        id: datasource,
      },
    });
  }
}

export async function postVisualChangeset(
  req: AuthRequest<Partial<VisualChangesetInterface>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!req.body.urlPatterns) {
    throw new Error("urlPatterns needs to be defined");
  }

  if (!req.body.editorUrl) {
    throw new Error("editorUrl needs to be defined");
  }

  const experiment = await getExperimentById(context, req.params.id);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const visualChangeset = await createVisualChangeset({
    experiment,
    urlPatterns: req.body.urlPatterns,
    editorUrl: req.body.editorUrl,
    context,
  });

  res.status(200).json({
    status: 200,
    visualChangeset,
  });
}

export async function putVisualChangeset(
  req: AuthRequest<Partial<VisualChangesetInterface>, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const visualChangeset = await findVisualChangesetById(req.params.id, org.id);
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    context,
    visualChangeset.experiment,
  );
  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const updates: Partial<VisualChangesetInterface> = {
    editorUrl: req.body.editorUrl,
    urlPatterns: req.body.urlPatterns,
    visualChanges: req.body.visualChanges,
  };

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = experiment
    ? getAffectedEnvsForExperiment({
        experiment,
        linkedFeatures,
        orgEnvironments: context.org.settings?.environments || [],
      })
    : [];
  if (!context.permissions.canRunExperiment(experiment, envs)) {
    context.permissions.throwPermissionError();
  }

  const ret = await updateVisualChangeset({
    visualChangeset,
    experiment,
    context,
    updates,
  });

  res.status(200).json({
    status: 200,
    data: {
      nModified: ret.nModified,
      changesetId: ret.nModified > 0 ? req.params.id : undefined,
      updates: ret.nModified > 0 ? req.body : undefined,
    },
  });
}

export async function deleteVisualChangeset(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const visualChangeset = await findVisualChangesetById(req.params.id, org.id);
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    context,
    visualChangeset.experiment,
  );

  const linkedFeatureIds = experiment?.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = experiment
    ? getAffectedEnvsForExperiment({
        experiment,
        linkedFeatures,
        orgEnvironments: context.org.settings?.environments || [],
      })
    : [];
  if (!context.permissions.canRunExperiment(experiment || {}, envs)) {
    context.permissions.throwPermissionError();
  }

  await deleteVisualChangesetById({
    visualChangeset,
    experiment,
    context,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function findOrCreateVisualEditorToken(
  req: AuthRequest,
  res: Response,
) {
  const { org } = getContextFromReq(req);

  if (!req.userId) throw new Error("No user found");

  let visualEditorKey = await getVisualEditorApiKey(org.id, req.userId);

  // if not exist, create one
  if (!visualEditorKey) {
    visualEditorKey = await createUserVisualEditorApiKey({
      userId: req.userId,
      organizationId: org.id,
      description: `Created automatically for the Visual Editor`,
    });
  }

  res.status(200).json({
    key: visualEditorKey.key,
  });
}

export async function getExperimentTimeSeries(
  req: AuthRequest<
    null,
    { id: string },
    { phase: string; metricIds: string[] }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { phase, metricIds } = req.query;
  const phaseIndex = parseInt(phase, 10);

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (metricIds.length === 0) {
    throw new Error("metricIds is required");
  }

  if (isNaN(phaseIndex)) {
    throw new Error("Invalid phase");
  }

  const timeSeries =
    await context.models.metricTimeSeries.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: id,
      sourcePhase: phaseIndex,
      metricIds,
    });

  res.status(200).json({
    status: 200,
    timeSeries,
  });
}
