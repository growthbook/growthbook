import { CreateFactTableProps } from "../../../types/fact-table";
import { PostFactTableResponse } from "../../../types/openapi";
import { queueFactTableColumnsRefresh } from "../../jobs/refreshFactTableColumns";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  createFactTable,
  toFactTableApiInterface,
} from "../../models/FactTableModel";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { addTags } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFactTableValidator } from "../../validators/openapi";

export const postFactTable = createApiRequestHandler(postFactTableValidator)(
  async (req): Promise<PostFactTableResponse> => {
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

    if (!req.context.permissions.canCreateFactTable(data)) {
      req.context.permissions.throwPermissionError();
    }
    const datasource = await getDataSourceById(
      req.context,
      req.body.datasource
    );
    if (!datasource) {
      throw new Error("Could not find datasource");
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

    const factTable = await createFactTable(req.context, data);
    await queueFactTableColumnsRefresh(factTable);

    if (data.tags.length > 0) {
      await addTags(req.organization.id, data.tags);
    }

    return {
      factTable: toFactTableApiInterface(factTable),
    };
  }
);
