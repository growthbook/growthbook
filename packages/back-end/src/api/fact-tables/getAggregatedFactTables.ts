import { getAggregatedFactTablesValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  buildAggregatedFactTableStatus,
  getAggregatedFactTableMetrics,
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
  const factMetrics = await req.context.models.factMetrics.getAll();
  const metrics = getAggregatedFactTableMetrics({ factMetrics, factTable });
  const { factTableSettingsHash, metricState } =
    buildAggregatedFactTableSchemaState({ factTable, metrics });

  const aggregatedFactTables = idTypes.map((idType) => {
    const status = buildAggregatedFactTableStatus({
      idType,
      doc: byIdType.get(idType),
      factTableSettingsHash,
      metricState,
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
