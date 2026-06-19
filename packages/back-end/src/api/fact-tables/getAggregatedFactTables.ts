import { getAggregatedFactTablesValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  buildAggregatedFactTableStatus,
  getActiveAggregatedFactTableMetrics,
  getAggregatedFactTableMetrics,
  getMaterializedMetricIds,
  getRunningExperimentMetricIds,
} from "back-end/src/services/aggregatedFactTables";
import { buildAggregatedFactTableSchemaState } from "back-end/src/enterprise/services/data-pipeline";
import { getNextUpdateOccurrence } from "back-end/src/util/factTable";

export const getAggregatedFactTables = createApiRequestHandler(
  getAggregatedFactTablesValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  const idTypes = factTable.aggregatedFactTableSettings?.idTypes ?? [];
  const registryDocs =
    await req.context.models.aggregatedFactTables.getByFactTableId(
      factTable.id,
    );
  const byIdType = new Map(registryDocs.map((doc) => [doc.idType, doc]));

  // Recompute the schema state the nightly driver would so callers can see when
  // the next run will be forced to restate. Read-only; no warehouse query.
  // The materialized metric set is per-idType (each idType has its own table),
  // so recompute it for each registry doc.
  const factMetrics = await req.context.models.factMetrics.getAll();
  const activeMetricIds = await getRunningExperimentMetricIds(req.context);

  const hasActiveMetrics =
    getActiveAggregatedFactTableMetrics({
      factMetrics,
      factTable,
      activeMetricIds,
    }).length > 0;

  const aggregatedFactTables = idTypes.map((idType) => {
    const doc = byIdType.get(idType);
    const metrics = getAggregatedFactTableMetrics({
      factMetrics,
      factTable,
      activeMetricIds,
      materializedMetricIds: getMaterializedMetricIds(doc),
    });
    const { factTableSettingsHash, metricState } =
      buildAggregatedFactTableSchemaState({ factTable, metrics });
    const status = buildAggregatedFactTableStatus({
      idType,
      doc,
      factTableSettingsHash,
      metricState,
      hasActiveMetrics,
    });
    return {
      idType: status.idType,
      status: status.status,
      tableFullName: status.tableFullName,
      firstEventDate: status.firstEventDate?.toISOString() ?? null,
      lastEventDate: status.lastEventDate?.toISOString() ?? null,
      lastMaxTimestamp: status.lastMaxTimestamp?.toISOString() ?? null,
      lastError: status.lastError,
      dateUpdated: status.dateUpdated?.toISOString() ?? null,
      pendingRestate: status.pendingRestate,
      pendingRestateReason: status.pendingRestateReason,
    };
  });

  const nextScheduledUpdate = factTable.aggregatedFactTableSettings
    ? getNextUpdateOccurrence(
        factTable.aggregatedFactTableSettings.updateTime,
      ).toISOString()
    : null;

  return {
    aggregatedFactTables,
    nextScheduledUpdate,
  };
});
