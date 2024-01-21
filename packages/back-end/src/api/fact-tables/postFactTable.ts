import {
  CreateFactTableProps,
  FactTableInterface,
} from "../../../types/fact-table";
import { PostFactTableResponse } from "../../../types/openapi";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  createFactTable,
  toFactTableApiInterface,
} from "../../models/FactTableModel";
import { addTags } from "../../models/TagModel";
import { updateColumns } from "../../routers/fact-table/fact-table.controller";
import { createApiRequestHandler } from "../../util/handler";
import { postFactTableValidator } from "../../validators/openapi";

export const postFactTable = createApiRequestHandler(postFactTableValidator)(
  async (req): Promise<PostFactTableResponse> => {
    req.checkPermissions("manageFactTables", req.body.projects || []);

    const datasource = await getDataSourceById(
      req.body.datasource,
      req.organization.id
    );
    if (!datasource) {
      throw new Error("Could not find datasource");
    }

    req.checkPermissions("runQueries", datasource.projects || "");

    const data: CreateFactTableProps = {
      columns: [],
      eventName: "",
      id: "",
      managedBy: "",
      description: "",
      owner: "",
      projects: [],
      tags: [],
      ...req.body,
    };

    // TODO: do this in a background job so we can return immediately
    data.columns = await updateColumns(datasource, data as FactTableInterface);
    if (!data.columns.length) {
      throw new Error("SQL did not return any rows");
    }

    const factTable = await createFactTable(req.organization.id, data);

    if (data.tags.length > 0) {
      await addTags(req.organization.id, data.tags);
    }

    return {
      factTable: toFactTableApiInterface(factTable),
    };
  }
);
