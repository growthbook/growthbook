import { refreshAggregatedFactTableValidator } from "shared/validators";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  runAggregatedFactTableUpdate,
  toAggregatedTableRefreshTriggerResult,
} from "back-end/src/services/aggregatedFactTables";

export const refreshAggregatedFactTable = createApiRequestHandler(
  refreshAggregatedFactTableValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new NotFoundError("Could not find factTable with that id");
  }

  if (!req.context.hasPremiumFeature("pipeline-mode")) {
    req.context.throwPlanDoesNotAllowError(
      "Maintaining shared daily aggregated tables requires the data pipeline feature.",
    );
  }

  const datasource = await getDataSourceById(req.context, factTable.datasource);
  if (!datasource) {
    throw new BadRequestError("Could not find datasource for this fact table");
  }

  if (!req.context.permissions.canUpdateDataSourceSettings(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  const enabledIdTypes = factTable.aggregatedFactTableSettings?.idTypes ?? [];
  if (!enabledIdTypes.length) {
    throw new BadRequestError(
      "This fact table does not have any id types enabled for shared daily aggregated tables.",
    );
  }

  let idTypes = enabledIdTypes;
  if (req.body.idType) {
    if (!enabledIdTypes.includes(req.body.idType)) {
      throw new BadRequestError(
        `id type '${req.body.idType}' is not enabled for shared daily aggregated tables on this fact table.`,
      );
    }
    idTypes = [req.body.idType];
  }

  const runs = [];
  for (const idType of idTypes) {
    const outcome = await runAggregatedFactTableUpdate(
      req.context,
      factTable,
      idType,
      {
        forceRestate: !!req.body.fullRestate,
        awaitResults: false,
      },
    );
    runs.push(toAggregatedTableRefreshTriggerResult(idType, outcome));
  }

  return { runs };
});
