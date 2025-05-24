import {
  fromUpdateDataSourcePayload,
  getDataSourceById,
  toDataSourceApiInterface,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateDataSourceValidator } from "back-end/src/validators/openapi";
import { UpdateDataSourceResponse } from "back-end/types/openapi";

export const putDataSource = createApiRequestHandler(updateDataSourceValidator)(
  async (req): Promise<UpdateDataSourceResponse> => {
    const { id } = req.params;
    const updates = fromUpdateDataSourcePayload(req.body);

    const existing = await getDataSourceById(req.context, id);
    if (!existing) {
      throw new Error("Data source not found");
    }
    if (
      updates.params &&
      !req.context.permissions.canUpdateDataSourceParams(existing)
    ) {
      req.context.permissions.throwPermissionError();
    }
    if (
      updates.settings &&
      !req.context.permissions.canUpdateDataSourceSettings(existing)
    ) {
      req.context.permissions.throwPermissionError();
    }
    if (
      (updates.name || updates.description || updates.projects) &&
      !req.context.permissions.canUpdateDataSourceSettings(existing)
    ) {
      req.context.permissions.throwPermissionError();
    }
    await updateDataSource(req.context, existing, updates);
    const updated = await getDataSourceById(req.context, id);
    if (!updated) {
      throw new Error("Failed to retrieve updated data source");
    }
    await req.audit({
      event: "datasource.update",
      entity: {
        object: "datasource",
        id: updated.id,
      },
      details: auditDetailsUpdate(existing, updated),
    });

    return {
      dataSource: toDataSourceApiInterface(updated),
    };
  }
);
