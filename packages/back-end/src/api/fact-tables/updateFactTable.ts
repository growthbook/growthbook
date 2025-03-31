import { UpdateFactTableProps } from "back-end/types/fact-table";
import { UpdateFactTableResponse } from "back-end/types/openapi";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateFactTable as updateFactTableInDb,
  toFactTableApiInterface,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateFactTableValidator } from "back-end/src/validators/openapi";

export const updateFactTable = createApiRequestHandler(
  updateFactTableValidator
)(
  async (req): Promise<UpdateFactTableResponse> => {
    const factTable = await getFactTable(req.context, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    if (!req.context.permissions.canUpdateFactTable(factTable, req.body)) {
      req.context.permissions.throwPermissionError();
    }

    // Validate projects
    if (req.body.projects?.length) {
      const projects = await req.context.models.projects.getAll();
      const projectIds = new Set(projects.map((p) => p.id));
      for (const projectId of req.body.projects) {
        if (!projectIds.has(projectId)) {
          throw new Error(`Project ${projectId} not found`);
        }
      }
    }

    // Validate userIdTypes
    if (req.body.userIdTypes) {
      const datasource = await getDataSourceById(
        req.context,
        factTable.datasource
      );
      if (!datasource) {
        throw new Error("Could not find datasource for this fact table");
      }
      for (const userIdType of req.body.userIdTypes) {
        if (
          !datasource.settings?.userIdTypes?.some(
            (t) => t.userIdType === userIdType
          )
        ) {
          throw new Error(`Invalid userIdType: ${userIdType}`);
        }
      }
    }

    const data: UpdateFactTableProps = { ...req.body };

    await updateFactTableInDb(req.context, factTable, data);
    if (needsColumnRefresh(data)) {
      await queueFactTableColumnsRefresh(factTable);
    }

    if (data.tags) {
      await addTagsDiff(req.organization.id, factTable.tags, data.tags);
    }

    return {
      factTable: toFactTableApiInterface({ ...factTable, ...req.body }),
    };
  }
);

export function needsColumnRefresh(changes: UpdateFactTableProps): boolean {
  return !!(changes.sql || changes.eventName);
}
