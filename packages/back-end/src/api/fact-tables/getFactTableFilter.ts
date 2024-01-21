import { GetFactTableFilterResponse } from "../../../types/openapi";
import {
  getFactTable,
  toFactTableFilterApiInterface,
} from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { getFactTableFilterValidator } from "../../validators/openapi";

export const getFactTableFilter = createApiRequestHandler(
  getFactTableFilterValidator
)(
  async (req): Promise<GetFactTableFilterResponse> => {
    const factTable = await getFactTable(
      req.organization.id,
      req.params.factTableId
    );
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    return {
      factTableFilter: toFactTableFilterApiInterface(factTable, req.params.id),
    };
  }
);
