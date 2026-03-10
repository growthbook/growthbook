import { ListFactTableFiltersResponse } from "shared/types/openapi";
import { listFactTableFiltersValidator } from "shared/validators";
import {
  getFactTable,
  toFactTableFilterApiInterface,
} from "back-end/src/models/FactTableModel";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listFactTableFilters = createApiRequestHandler(
  listFactTableFiltersValidator,
)(async (req): Promise<ListFactTableFiltersResponse> => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    factTable.filters.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    factTableFilters: filtered.map((filter) =>
      toFactTableFilterApiInterface(factTable, filter.id),
    ),
    ...returnFields,
  };
});
