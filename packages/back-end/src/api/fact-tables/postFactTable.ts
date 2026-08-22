import { omit } from "lodash";
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
  columnsNeedDetection,
  validateAggregatedFactTableSettings,
  validateNewUserIdColumnKeys,
  validateVirtualColumnProps,
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
      // A new fact table can define its virtual columns up front, but `sql`
      // only ever belongs to a virtual column — on a SQL-detected column it is
      // inert (see `getColumnExpression`) and would just be misleading state.
      ...(req.body.columns
        ? {
            columns: req.body.columns.map((col) =>
              col.isVirtual ? col : omit(col, ["sql"]),
            ),
          }
        : {}),
      owner,
    };

    // Virtual columns carry raw SQL that gets inlined into generated queries,
    // so they must clear the same bar here as on the dedicated virtual-column
    // endpoints and bulk import: a `_vc` id, an explicit datatype, and a
    // structurally safe expression. (The official-resources gate is already
    // applied by `canCreateFactTable` inside `createFactTable`.)
    for (const col of data.columns || []) {
      if (col.isVirtual) {
        validateVirtualColumnProps(col);
      }
    }

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

    if (req.body.userIdColumns) {
      validateNewUserIdColumnKeys({
        datasource,
        userIdColumns: req.body.userIdColumns,
      });
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

    data.columnRefreshPending =
      !data.columns?.length || columnsNeedDetection(data.columns);

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
