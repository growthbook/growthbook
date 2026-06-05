import { refreshAggregatedFactTableValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runAggregatedFactTableUpdate } from "back-end/src/jobs/updateAggregatedFactTables";

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

  const enabledIdTypes = factTable.aggregatedFactTableSettings?.idTypes ?? [];
  if (!enabledIdTypes.length) {
    throw new Error(
      "This fact table does not have any id types enabled for shared daily aggregated tables.",
    );
  }

  let idTypes = enabledIdTypes;
  if (req.body.idType) {
    if (!enabledIdTypes.includes(req.body.idType)) {
      throw new Error(
        `id type '${req.body.idType}' is not enabled for shared daily aggregated tables on this fact table.`,
      );
    }
    idTypes = [req.body.idType];
  }

  // Kick off directly (not via the nightly agenda queue); each call returns
  // once the run doc + queries exist and finishes in the background.
  for (const idType of idTypes) {
    await runAggregatedFactTableUpdate(req.context, factTable, idType, {
      forceRestate: !!req.body.fullRestate,
      awaitResults: false,
    });
  }

  return { queued: idTypes };
});
