import { listAggregatedTableRunsValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { toAggregatedTableRunSummaryApiInterface } from "back-end/src/services/aggregatedFactTables";

export const listAggregatedTableRuns = createApiRequestHandler(
  listAggregatedTableRunsValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new NotFoundError("Could not find factTable with that id");
  }

  const { idType } = req.query;
  if (
    idType &&
    !(factTable.aggregatedFactTableSettings?.idTypes ?? []).includes(idType)
  ) {
    throw new BadRequestError(
      `id type '${idType}' is not enabled for shared daily aggregated tables on this fact table.`,
    );
  }

  const { limit, offset } = validatePagination(req.query);
  const { runs, total } =
    await req.context.models.aggregatedFactTableRuns.getByFactTableAndIdType(
      factTable.id,
      idType,
      { limit, skip: offset },
    );

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return {
    runs: runs.map(toAggregatedTableRunSummaryApiInterface),
    limit,
    offset,
    count: runs.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
