import {
  ExperimentInterfaceExcludingHoldouts,
  listExperimentsValidator,
} from "shared/validators";
import { stringToBoolean } from "shared/util";
import { ProjectInterface } from "shared/types/project";
import { ExperimentInterface } from "shared/types/experiment";
import {
  countExperiments,
  getAllExperiments,
  getExperimentsPage,
} from "back-end/src/models/ExperimentModel";
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
  validatePagination,
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

  const sortBy = req.query.sortBy ?? "dateCreated";
  const sortDir = req.query.sortOrder === "desc" ? -1 : 1;

  // Filters with the app's experiment-list semantics (case-insensitive
  // matching; values within a category ORed, categories ANDed). These aren't
  // expressible in the Mongo query, so requesting any of them takes the
  // fetch-all path below.
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
  const hasInMemoryFilters = Object.values(filters).some(
    (value) => value !== undefined,
  );

  const bandits =
    req.query.bandits === "true"
      ? true
      : req.query.bandits === "false"
        ? false
        : undefined;

  // Shared serializer for whichever path produced the page
  const serializePage = async (page: ExperimentInterface[]) => {
    // Batch-load all projects for the page to avoid N+1 queries
    const pageProjectIds = [
      ...new Set(
        page.map((exp) => exp.project).filter((p): p is string => !!p),
      ),
    ];
    const projects = pageProjectIds.length
      ? await req.context.models.projects.getByIds(pageProjectIds)
      : [];
    const projectMap = new Map<string, ProjectInterface>(
      projects.map((p) => [p.id, p]),
    );
    const promises = page.map((experiment) =>
      toExperimentApiInterface(
        req.context,
        experiment as ExperimentInterfaceExcludingHoldouts,
        projectMap,
      ),
    );
    return resolveOwnerEmails(await Promise.all(promises), req.context);
  };

  // Fast path: every requested filter is expressible in the Mongo query and
  // the sort is backed by an { organization, <date> } index, so page in the
  // database instead of materializing the whole org's experiments. `name`
  // sorts take the fetch-all path so they can sort case-insensitively.
  // The query is pre-scoped to readable projects to keep the page and total
  // correct (mirrors loadFeaturesPage).
  if (!hasInMemoryFilters && sortBy !== "name") {
    const { limit, offset } = validatePagination(req.query);
    const emptyPage = {
      experiments: [],
      limit,
      offset,
      count: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    };

    let projectIds: string[] | undefined;
    if (req.query.projectId) {
      if (
        !req.context.permissions.canReadSingleProjectResource(
          req.query.projectId,
        )
      ) {
        return emptyPage;
      }
    } else {
      const readable =
        req.context.permissions.getProjectsWithPermission("readData");
      if (readable !== null) {
        if (readable.length === 0) return emptyPage;
        projectIds = readable;
      }
    }

    const dbFilters = {
      includeArchived: true,
      archived,
      project: req.query.projectId,
      projectIds,
      datasourceId: req.query.datasourceId,
      trackingKey: req.query.trackingKey ?? req.query.experimentId,
      status: req.query.status,
      // The bandits param maps onto the type field (omitting type still
      // excludes holdouts)
      type:
        bandits === true
          ? ("multi-armed-bandit" as const)
          : bandits === false
            ? ("standard" as const)
            : undefined,
    };

    const [page, total] = await Promise.all([
      getExperimentsPage(req.context, {
        ...dbFilters,
        // _id tiebreak keeps equal dates paginating deterministically
        sort: { [sortBy]: sortDir, _id: 1 },
        limit,
        offset,
      }),
      countExperiments(req.context, dbFilters),
    ]);

    const nextOffset = offset + limit;
    const hasMore = nextOffset < total;
    return {
      experiments: await serializePage(page),
      limit,
      offset,
      count: page.length,
      total,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    };
  }

  // Fetch-all path: in-memory filters and/or a name sort were requested.
  // Filter at the database level where possible
  // Note: type is not specified, which defaults to excluding holdouts
  const experiments = await getAllExperiments(req.context, {
    includeArchived: true,
    archived,
    project: req.query.projectId,
    datasourceId: req.query.datasourceId,
    trackingKey: req.query.trackingKey ?? req.query.experimentId,
    status: req.query.status,
  });

  // Resolvers require extra lookups (projects, org members), so skip the
  // filter pass entirely when only a name sort routed us here
  const filteredExperiments =
    hasInMemoryFilters || bandits !== undefined
      ? filterExperiments({
          experiments,
          filters,
          resolvers: await buildExperimentFilterResolvers(req.context),
          bandits,
        })
      : experiments;

  // Sort in Node: this path materializes the full (permission-filtered)
  // result set for in-memory pagination anyway, so sorting here is free,
  // sidesteps Mongo's in-memory sort memory ceiling on large orgs, and lets
  // `name` sort case-insensitively (Mongo would sort by raw byte order)
  const sorted = [...filteredExperiments].sort((a, b) => {
    const diff =
      sortBy === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : a[sortBy].getTime() - b[sortBy].getTime();
    return sortDir === -1 ? -diff : diff;
  });

  const { filtered, returnFields } = applyPagination(sorted, req.query);

  return {
    experiments: await serializePage(filtered),
    ...returnFields,
  };
});
