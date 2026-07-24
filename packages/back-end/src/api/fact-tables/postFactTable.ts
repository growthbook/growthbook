import { postFactTableValidator } from "shared/validators";
import { CreateFactTableProps } from "shared/types/fact-table";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  createFactTable,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import { addTags } from "back-end/src/models/TagModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import {
  columnsHaveAutoSlices,
  validateAggregatedFactTableSettings,
} from "back-end/src/util/factTable";

export const postFactTable = createApiRequestHandler(postFactTableValidator)(
  async (req) => {
    const owner =
      (await resolveOwnerToUserId(req.body.owner, req.context)) ?? "";
    const data: CreateFactTableProps = {
      eventName: "",
      id: "",
      description: "",
      projects: [],
      tags: [],
      ...req.body,
      owner,
    };

    if (
      columnsHaveAutoSlices(req.body.columns) &&
      !req.context.hasPremiumFeature("metric-slices")
    ) {
      throw new Error("Metric slices require an enterprise license");
    }

    const datasource = await getDataSourceById(
      req.context,
      req.body.datasource,
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
            (t) => t.userIdType === userIdType,
          )
        ) {
          throw new Error(`Invalid userIdType: ${userIdType}`);
        }
      }
    }

    if (req.body.aggregatedFactTableSettings) {
      if (!req.context.hasPremiumFeature("pipeline-mode")) {
        throw new Error(
          "Maintaining shared daily aggregated tables requires the data pipeline feature.",
        );
      }
      if (!req.context.permissions.canUpdateDataSourceSettings(datasource)) {
        req.context.permissions.throwPermissionError();
      }
      validateAggregatedFactTableSettings(
        req.body.aggregatedFactTableSettings,
        req.body.userIdTypes,
      );
    }

    const factTable = await createFactTable(req.context, data);
    await queueFactTableColumnsRefresh(factTable);

    if (data.tags.length > 0) {
      await addTags(req.organization.id, data.tags);
    }

    return {
      factTable: await resolveOwnerEmail(
        toFactTableApiInterface(factTable),
        req.context,
      ),
    };
  },
);
