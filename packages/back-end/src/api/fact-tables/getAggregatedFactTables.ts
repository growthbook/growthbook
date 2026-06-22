import { getAggregatedFactTablesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getAggregatedFactTableStatuses } from "back-end/src/services/aggregatedFactTables";

export const getAggregatedFactTables = createApiRequestHandler(
  getAggregatedFactTablesValidator,
)(async (req) => {
  const { aggregatedFactTables, nextScheduledUpdate } =
    await getAggregatedFactTableStatuses(req.context, req.params.id);

  return {
    aggregatedFactTables: aggregatedFactTables.map((status) => ({
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
    })),
    nextScheduledUpdate: nextScheduledUpdate?.toISOString() ?? null,
  };
});
