import {
  ExperimentInterfaceExcludingHoldouts,
  listExperimentsValidator,
} from "shared/validators";
import { stringToBoolean } from "shared/util";
import { ProjectInterface } from "shared/types/project";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import {
  buildExperimentFilterResolvers,
  filterExperiments,
  normalizeExperimentFilters,
  parseExperimentSearchString,
  splitCsv,
} from "back-end/src/services/experimentFilters";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listExperiments = createApiRequestHandler(
  listExperimentsValidator,
)(async (req) => {
  if (req.query.trackingKey && req.query.experimentId) {
    throw new Error(
      "Cannot use both trackingKey and experimentId query parameters. Use trackingKey instead.",
    );
  }

  // Reject unsupported search syntax (negation/operators) with a 400 instead
  // of silently dropping it like the internal endpoint does
  if (req.query.q) {
    parseExperimentSearchString(req.query.q, { strict: true });
  }

  // booleanQueryField accepts string and native boolean forms; normalize to
  // a tri-state boolean (undefined = don't filter on archived)
  const archived =
    req.query.archived === undefined
      ? undefined
      : stringToBoolean(req.query.archived.toString());

  // Filter and sort at the database level where possible
  // Note: type is not specified, which defaults to excluding holdouts
  const experiments = await getAllExperiments(req.context, {
    includeArchived: true,
    archived,
    project: req.query.projectId,
    datasourceId: req.query.datasourceId,
    trackingKey: req.query.trackingKey ?? req.query.experimentId,
    status: req.query.status,
    sortBy: {
      [req.query.sortBy ?? "dateCreated"]:
        req.query.sortOrder === "desc" ? -1 : 1,
    },
  });

  // The remaining filters share the app's experiment-list semantics (matching
  // is case-insensitive; values within a category are ORed, categories are
  // ANDed), so apply them in memory via the shared filtering service.
  // filterExperiments preserves input order, keeping the sort from above.
  const filters = normalizeExperimentFilters({
    searchString: req.query.q,
    filters: {
      owners: splitCsv(req.query.owner),
      results: splitCsv(req.query.result),
      tags: splitCsv(req.query.tag),
      implementationTypes: splitCsv(req.query.implementationType),
      metrics: splitCsv(req.query.metricId),
    },
  });

  const bandits =
    req.query.bandits === "true"
      ? true
      : req.query.bandits === "false"
        ? false
        : undefined;

  // Resolvers require extra lookups (projects, org members), so skip the
  // filter pass entirely when no in-memory filters were requested
  const hasFilters =
    bandits !== undefined ||
    Object.values(filters).some((value) => value !== undefined);
  const filteredExperiments = hasFilters
    ? filterExperiments({
        experiments,
        filters,
        resolvers: await buildExperimentFilterResolvers(req.context),
        bandits,
      })
    : experiments;

  // TODO: Move pagination (limit/offset) to database for better performance
  const { filtered, returnFields } = applyPagination(
    filteredExperiments,
    req.query,
  );

  // Batch-load all projects for the filtered experiments to avoid N+1 queries
  const projectIds = [
    ...new Set(
      filtered.map((exp) => exp.project).filter((p): p is string => !!p),
    ),
  ];
  const projects = projectIds.length
    ? await req.context.models.projects.getByIds(projectIds)
    : [];
  const projectMap = new Map<string, ProjectInterface>(
    projects.map((p) => [p.id, p]),
  );

  const promises = filtered.map((experiment) =>
    toExperimentApiInterface(
      req.context,
      experiment as ExperimentInterfaceExcludingHoldouts,
      projectMap,
    ),
  );
  const apiExperiments = await resolveOwnerEmails(
    await Promise.all(promises),
    req.context,
  );

  return {
    experiments: apiExperiments,
    ...returnFields,
  };
});
