import { CreateFactTableProps } from "back-end/types/fact-table";
import { PostFactTableResponse } from "back-end/types/openapi";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  createFactTable,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import { addTags } from "back-end/src/models/TagModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postFactTableValidator } from "back-end/src/validators/openapi";

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
