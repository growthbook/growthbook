import { CreateFactTableProps } from "../../../types/fact-table";
import { PostFactTableResponse } from "../../../types/openapi";
import { queueFactTableColumnsRefresh } from "../../jobs/refreshFactTableColumns";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  createFactTable,
  toFactTableApiInterface,
} from "../../models/FactTableModel";
import { addTags } from "../../models/TagModel";
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

    const data: CreateFactTableProps = {
      columns: [],
      eventName: "",
      id: "",
      description: "",
      owner: "",
      projects: [],
      tags: [],
      ...req.body,
    };

    const factTable = await createFactTable(req.organization.id, data);
    await queueFactTableColumnsRefresh(factTable);

    if (data.tags.length > 0) {
      await addTags(req.organization.id, data.tags);
    }

    return {
      factTable: toFactTableApiInterface(factTable),
    };
  }
);
