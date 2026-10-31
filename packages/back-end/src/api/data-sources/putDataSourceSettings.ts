import uniqid from "uniqid";
import { putDataSourceSettingsValidator } from "shared/validators";
import {
  getDataSourceById,
  toDataSourceApiInterface,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { assertCanUpdateDataSource } from "back-end/src/controllers/datasources";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  findRepeatedAssignmentQueryId,
  mergeDataSourceSettingsBody,
  testDataSourceSettingsQueries,
} from "back-end/src/services/dataSourceSettingsApi";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const putDataSourceSettings = createApiRequestHandler(
  putDataSourceSettingsValidator,
)(async (req) => {
  const { context } = req;
  const { permissions } = context;
  const datasource = await getDataSourceById(context, req.params.id);
  if (!datasource) {
    return context.throwNotFoundError(
      "Could not find a Data Source with that id",
    );
  }

  const repeatedId = findRepeatedAssignmentQueryId(req.body.assignmentQueries);
  if (repeatedId !== null) {
    context.throwBadRequestError(
      `Assignment query "${repeatedId}" is listed more than once`,
    );
  }

  // As in the dashboard, a member who can't edit the whole Data Source gets
  // server ids for the assignment queries they add
  const merged = mergeDataSourceSettingsBody(
    datasource.settings ?? {},
    req.body,
    permissions.canUpdateDataSourceSettings(datasource)
      ? undefined
      : () => uniqid("exq_"),
  );
  if (!merged.changed) {
    return { dataSource: toDataSourceApiInterface(datasource), changed: false };
  }

  assertCanUpdateDataSource(context, datasource, { settings: merged.settings });
  // Analysis looks queries up by id, so a change reaches every stored query
  // that shares it
  const storedQueries = datasource.settings?.queries?.exposure ?? [];
  for (const query of merged.changedExposureQueries) {
    if (
      storedQueries
        .filter((q) => q.id === query.id)
        .some((q) => !permissions.canUpdateExposureQuery(q, datasource))
    ) {
      permissions.throwPermissionError();
    }
  }

  const updates = { settings: merged.settings };
  // The existing save checks, before any SQL runs
  const checked = await updateDataSource(context, datasource, updates, {
    skipExposureQueryValidation: true,
    dryRun: true,
  });

  const refusal = await testDataSourceSettingsQueries(
    getSourceIntegrationObject(context, datasource),
    datasource,
    {
      exposureQueries: merged.changedExposureQueries,
      identityJoins: merged.newIdentityJoins,
      testDays: context.org.settings?.testQueryDays,
    },
  );
  if (refusal) context.throwBadRequestError(refusal);

  if (req.body.dryRun) {
    return {
      dataSource: toDataSourceApiInterface({
        ...datasource,
        settings: checked.settings ?? merged.settings,
      }),
      changed: true,
    };
  }

  // Already tested above, so the save doesn't run them again
  await updateDataSource(context, datasource, updates, {
    skipExposureQueryValidation: true,
  });
  const saved = await getDataSourceById(context, datasource.id);
  return {
    dataSource: toDataSourceApiInterface(saved ?? datasource),
    changed: true,
  };
});
