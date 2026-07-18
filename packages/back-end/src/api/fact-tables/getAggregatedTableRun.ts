import { getAggregatedTableRunValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { toAggregatedTableRunApiInterface } from "back-end/src/services/aggregatedFactTables";

export const getAggregatedTableRun = createApiRequestHandler(
  getAggregatedTableRunValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new NotFoundError("Could not find factTable with that id");
  }

  const run = await req.context.models.aggregatedFactTableRuns.getById(
    req.params.runId,
  );
  if (!run || run.factTableId !== factTable.id) {
    throw new NotFoundError(
      `An aggregated table run with id ${req.params.runId} does not exist for this fact table`,
    );
  }

  return {
    run: toAggregatedTableRunApiInterface(run),
  };
});
