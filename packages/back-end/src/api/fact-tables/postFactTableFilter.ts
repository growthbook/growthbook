import { PostFactTableFilterResponse } from "shared/types/openapi";
import { postFactTableFilterValidator } from "shared/validators";
import {
  createFactFilter,
  getFactTable,
  toFactTableFilterApiInterface,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postFactTableFilter = createApiRequestHandler(
  postFactTableFilterValidator,
)(async (req): Promise<PostFactTableFilterResponse> => {
  const factTable = await getFactTable(req.context, req.params.factTableId);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  if (!req.context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    req.context.permissions.throwPermissionError();
  }

  if (req.body.managedBy === "api" && !factTable.managedBy) {
    throw new Error(
      "Cannot set filter to be managed by api unless Fact Table is also managed by api",
    );
  }

  const filter = await createFactFilter(factTable, {
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
