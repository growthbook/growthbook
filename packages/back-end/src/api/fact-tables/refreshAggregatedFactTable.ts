import { refreshAggregatedFactTableValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runAggregatedFactTableUpdate } from "back-end/src/services/aggregatedFactTables";

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

  const datasource = await getDataSourceById(req.context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource for this fact table");
  }

  if (!req.context.permissions.canUpdateDataSourceSettings(datasource)) {
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

  for (const idType of idTypes) {
    await runAggregatedFactTableUpdate(req.context, factTable, idType, {
      forceRestate: !!req.body.fullRestate,
      awaitResults: false,
    });
  }

  return { queued: idTypes };
});
