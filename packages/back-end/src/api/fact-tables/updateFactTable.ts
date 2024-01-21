import {
  FactTableInterface,
  UpdateFactTableProps,
} from "../../../types/fact-table";
import { UpdateFactTableResponse } from "../../../types/openapi";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  updateFactTable as updateFactTableInDb,
  toFactTableApiInterface,
  getFactTable,
} from "../../models/FactTableModel";
import { addTagsDiff } from "../../models/TagModel";
import { updateColumns } from "../../routers/fact-table/fact-table.controller";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactTableValidator } from "../../validators/openapi";

export const updateFactTable = createApiRequestHandler(
  updateFactTableValidator
)(
  async (req): Promise<UpdateFactTableResponse> => {
    const factTable = await getFactTable(req.organization.id, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }
    req.checkPermissions("manageFactTables", factTable.projects);
    if (req.body.projects) {
      req.checkPermissions("manageFactTables", req.body.projects);
    }

    const datasource = await getDataSourceById(
      factTable.datasource,
      req.organization.id
    );
    if (!datasource) {
      throw new Error("Could not find datasource");
    }
    req.checkPermissions("runQueries", datasource.projects || "");

    const data: UpdateFactTableProps = { ...req.body };

    // Update the columns
    if (data.sql && data.sql !== factTable.sql) {
      data.columns = await updateColumns(datasource, {
        ...factTable,
        ...data,
      } as FactTableInterface);
    }

    if (!data.columns?.some((col) => !col.deleted)) {
      throw new Error("SQL did not return any rows");
    }

    await updateFactTableInDb(factTable, req.body, req.eventAudit);

    if (data.tags) {
      await addTagsDiff(req.organization.id, factTable.tags, data.tags);
    }

    return {
      factTable: toFactTableApiInterface({ ...factTable, ...req.body }),
    };
  }
);
