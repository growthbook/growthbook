import { ReqContext } from "back-end/types/request";
import { getMetricsForDefinitions } from "back-end/src/models/MetricModel";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { getDataSourcesWithParams } from "back-end/src/services/datasourceResponse";
import { findDimensionsByOrganization } from "back-end/src/models/DimensionModel";
import { getAllTags } from "back-end/src/models/TagModel";
import { getAllFactTablesForDefinitions } from "back-end/src/models/FactTableModel";

/**
 * Assembles the data for the `/organization/definitions` response.
 *
 * INVARIANT: every collection read here (including reads nested inside the
 * helpers, like event forwarder configs inside getDataSourcesWithParams) must
 * bump the org's definitions version on write — via `affectsDefinitionsVersion`
 * on BaseModels or manual `touchDefinitionsVersion` calls in legacy models —
 * or the endpoint serves stale 304s. Enforced by
 * `test/services/definitions.test.ts`, which observes the actual DB reads;
 * keep new reads inside this function so the test sees them.
 */
export async function getDefinitionsData(context: ReqContext) {
  const orgId = context.org.id;

  const [
    metrics,
    datasources,
    dimensions,
    segments,
    metricGroups,
    tags,
    savedGroups,
    constants,
    configs,
    customFields,
    projects,
    factTables,
    factMetrics,
    decisionCriteria,
    webhookSecrets,
  ] = await Promise.all([
    getMetricsForDefinitions(context),
    getDataSourcesByOrganization(context).then((ds) =>
      getDataSourcesWithParams(context, ds),
    ),
    findDimensionsByOrganization(orgId),
    context.models.segments.getAll(),
    context.models.metricGroups.getAll(),
    getAllTags(orgId),
    context.models.savedGroups.getAllWithoutValues(),
    context.models.constants.getAllWithoutValues(),
    context.models.configs.getAllWithoutValues(),
    context.models.customFields.getCustomFields(),
    context.models.projects.getAll(),
    getAllFactTablesForDefinitions(context),
    context.models.factMetrics.getAll(),
    context.models.decisionCriteria.getAll(),
    context.models.webhookSecrets.getAllForFrontEnd(),
  ]);

  // A dimension inherits project access from its datasource, so drop any whose
  // datasource is inaccessible or no longer exists.
  const readableDatasourceIds = new Set(datasources.map((ds) => ds.id));
  const visibleDimensions = dimensions.filter((dimension) =>
    readableDatasourceIds.has(dimension.datasource),
  );

  return {
    metrics,
    datasources,
    dimensions: visibleDimensions,
    segments,
    metricGroups,
    tags,
    savedGroups,
    constants,
    configs,
    customFields: customFields?.fields ?? [],
    projects,
    factTables,
    factMetrics,
    decisionCriteria,
    webhookSecrets,
  };
}
