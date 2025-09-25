import { PostFactTableFilterResponse } from "back-end/types/openapi";
import {
  createFactFilter,
  getFactTable,
  toFactTableFilterApiInterface,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postFactTableFilterValidator } from "back-end/src/validators/openapi";

export const postFactTableFilter = createApiRequestHandler(
  postFactTableFilterValidator,
)(async (req): Promise<PostFactTableFilterResponse> => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  const filter = await createFactFilter(req.context, factTable, {
    description: "",
    ...req.body,
  });

  return {
    factTableFilter: toFactTableFilterApiInterface(
      {
        ...factTable,
        filters: [...factTable.filters, filter],
      },
      filter.id,
    ),
  };
});
