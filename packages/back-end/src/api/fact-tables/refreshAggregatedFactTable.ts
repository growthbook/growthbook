import { refreshAggregatedFactTableValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { queueAggregatedFactTableUpdate } from "back-end/src/jobs/updateAggregatedFactTables";

export const refreshAggregatedFactTable = createApiRequestHandler(
  refreshAggregatedFactTableValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  if (!req.context.hasPremiumFeature("pipeline-mode")) {
    throw new Error(
      "Maintaining shared daily aggregated tables requires the data pipeline feature.",
    );
  }

  if (!req.context.permissions.canUpdateFactTable(factTable, {})) {
    req.context.permissions.throwPermissionError();
  }

  const enabledIdTypes = factTable.aggregatedFactTableIdTypes ?? [];
  if (!enabledIdTypes.length) {
    throw new Error(
      "This fact table does not have any id types enabled for shared daily aggregated tables.",
    );
  }

  // Default to all enabled id types; otherwise validate the requested one.
  let idTypes = enabledIdTypes;
  if (req.body.idType) {
    if (!enabledIdTypes.includes(req.body.idType)) {
      throw new Error(
        `id type '${req.body.idType}' is not enabled for shared daily aggregated tables on this fact table.`,
      );
    }
    idTypes = [req.body.idType];
  }

  for (const idType of idTypes) {
    await queueAggregatedFactTableUpdate({
      organization: factTable.organization,
      factTableId: factTable.id,
      idType,
      forceRestate: !!req.body.fullRestate,
    });
  }

  return { queued: idTypes };
});
