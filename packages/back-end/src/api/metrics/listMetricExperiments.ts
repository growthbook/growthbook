import { listMetricExperimentsValidator } from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import {
  getFilteredExperimentsUsingMetric,
  parseExperimentSearchString,
  splitCsv,
  StructuredExperimentFilters,
} from "back-end/src/services/experimentFilters";
import {
  _getSnapshots,
  getExperimentMetricById,
} from "back-end/src/services/experiments";

export const listMetricExperiments = createApiRequestHandler(
  listMetricExperimentsValidator,
)(async (req) => {
  const metricId = req.params.id;

  // Ensure the metric (fact or classic) exists and is readable
  const metric = await getExperimentMetricById(req.context, metricId);
  if (!metric) {
    throw new Error("Could not find metric with that id");
  }

  // Reject unsupported search syntax (negation/operators) with a 400 instead
  // of silently dropping it like the internal endpoint does
  if (req.query.q) {
    parseExperimentSearchString(req.query.q, { strict: true });
  }

  const filters: StructuredExperimentFilters = {
    projects: splitCsv(req.query.projectId),
    owners: splitCsv(req.query.owner),
    statuses: splitCsv(req.query.status),
    results: splitCsv(req.query.result),
    tags: splitCsv(req.query.tag),
    types: splitCsv(req.query.type),
  };

  const bandits =
    req.query.bandits === "true"
      ? true
      : req.query.bandits === "false"
        ? false
        : undefined;

  const experiments = await getFilteredExperimentsUsingMetric({
    context: req.context,
    metricId,
    searchString: req.query.q,
    filters,
    bandits,
    startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
    endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
    limit: 1000,
  });

  // Paginate before loading snapshots so we only hydrate the page we return;
  // pagination metadata still reflects the full filtered set.
  const { filtered: pagedExperiments, returnFields } = applyPagination(
    experiments,
    req.query,
  );

  const snapshots = await _getSnapshots(
    req.context,
    pagedExperiments,
    undefined,
    true,
    [metricId],
  );

  const experimentResults = pagedExperiments.map((experiment) => {
    const snapshot = snapshots.find((s) => s.experiment === experiment.id);
    const analysis = snapshot?.analyses?.[0];
    const snapshotVariations = analysis?.results?.[0]?.variations ?? [];
    const phaseVariations = getLatestPhaseVariations(experiment);

    const variations = phaseVariations.map((variation, i) => {
      const metricResult = snapshotVariations[i]?.metrics?.[metricId];
      return {
        variationId: variation.id,
        variationName: variation.name,
        users: metricResult?.users,
        value: metricResult?.value,
        mean: metricResult?.cr,
        lift: metricResult?.uplift?.mean,
        ci: metricResult?.ci,
        pValue: metricResult?.pValue,
        chanceToWin: metricResult?.chanceToWin,
      };
    });

    const lastPhase = experiment.phases[experiment.phases.length - 1];
    const date = (
      lastPhase?.dateEnded ??
      lastPhase?.dateStarted ??
      experiment.dateCreated
    ).toISOString();

    return {
      experimentId: experiment.id,
      experimentName: experiment.name,
      status: experiment.status,
      result: experiment.results,
      date,
      datasourceId: experiment.datasource,
      variations,
    };
  });

  return {
    experimentResults,
    ...returnFields,
  };
});
