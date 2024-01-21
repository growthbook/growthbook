import { PostFactTableResponse } from "../../../types/openapi";
import {
  createFactTable,
  toFactTableApiInterface,
} from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFactTableValidator } from "../../validators/openapi";

export const postFactTable = createApiRequestHandler(postFactTableValidator)(
  async (req): Promise<PostFactTableResponse> => {
    req.checkPermissions("manageFactTables", req.body.projects || []);

    const factTable = await createFactTable(req.organization.id, {
      columns: [],
      eventName: "",
      id: "",
      managedBy: "",
      description: "",
      owner: "",
      projects: [],
      tags: [],
      ...req.body,
    });

    return {
      factTable: toFactTableApiInterface(factTable),
    };
  }
);
