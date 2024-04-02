import { UpdateFactTableProps } from "../../../types/fact-table";
import { UpdateFactTableResponse } from "../../../types/openapi";
import { queueFactTableColumnsRefresh } from "../../jobs/refreshFactTableColumns";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  updateFactTable as updateFactTableInDb,
  toFactTableApiInterface,
  getFactTable,
} from "../../models/FactTableModel";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { addTagsDiff } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactTableValidator } from "../../validators/openapi";

export const updateFactTable = createApiRequestHandler(
  updateFactTableValidator
)(
  async (req): Promise<UpdateFactTableResponse> => {
    const factTable = await getFactTable(req.context, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }
    req.checkPermissions("manageFactTables", factTable.projects);
    if (req.body.projects) {
      req.checkPermissions("manageFactTables", req.body.projects);
    }

    const datasource = await getDataSourceById(
      req.context,
      factTable.datasource
    );
    if (!datasource) {
      throw new Error("Could not find datasource for this fact table");
    }

    // Validate projects
    if (req.body.projects?.length) {
      const projects = await findAllProjectsByOrganization(req.context);
      const projectIds = new Set(projects.map((p) => p.id));
      for (const projectId of req.body.projects) {
        if (!projectIds.has(projectId)) {
          throw new Error(`Project ${projectId} not found`);
        }
      }
    }

    if (
      datasource.projects?.length &&
      req.body.projects &&
      !req.body.projects.length
    ) {
      throw new Error(
        "A Fact Table's project list must be a subset of the connected data source's project list."
      );
    }

    // Validate userIdTypes
    if (req.body.userIdTypes) {
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
    await queueFactTableColumnsRefresh(factTable);

    if (data.tags) {
      await addTagsDiff(req.organization.id, factTable.tags, data.tags);
    }

    return {
      factTable: toFactTableApiInterface({ ...factTable, ...req.body }),
    };
  }
);
