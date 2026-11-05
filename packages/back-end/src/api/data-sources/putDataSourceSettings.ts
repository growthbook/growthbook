import isEqual from "lodash/isEqual";
import uniqid from "uniqid";
import { putDataSourceSettingsValidator } from "shared/validators";
import { ExposureQuery, IdentityJoinQuery } from "shared/types/datasource";
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
import { ConflictError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

// How many times a save is re-merged onto a version another save landed on
const MAX_SAVE_ATTEMPTS = 3;

type TestedQueries = {
  exposureQueries: ExposureQuery[];
  identityJoins: IdentityJoinQuery[];
};

export const putDataSourceSettings = createApiRequestHandler(
  putDataSourceSettingsValidator,
)(async (req) => {
  const { context } = req;
  const { permissions } = context;

  const repeatedId = findRepeatedAssignmentQueryId(req.body.assignmentQueries);
  if (repeatedId !== null) {
    context.throwBadRequestError(
      `Assignment query "${repeatedId}" is listed more than once`,
    );
  }

  let tested: TestedQueries | null = null;
  for (let attempt = 1; ; attempt++) {
    const datasource = await getDataSourceById(context, req.params.id);
    if (!datasource) {
      return context.throwNotFoundError(
        "Could not find a Data Source with that id",
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
      return {
        dataSource: toDataSourceApiInterface(datasource),
        changed: false,
      };
    }

    assertCanUpdateDataSource(context, datasource, {
      settings: merged.settings,
    });
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

    // A retry only goes back to the warehouse when the re-merge changed what
    // would be saved
    const toTest: TestedQueries = {
      exposureQueries: merged.changedExposureQueries,
      identityJoins: merged.newIdentityJoins,
    };
    if (!isEqual(toTest, tested)) {
      const refusal = await testDataSourceSettingsQueries(
        getSourceIntegrationObject(context, datasource),
        datasource,
        { ...toTest, testDays: context.org.settings?.testQueryDays },
      );
      if (refusal) context.throwBadRequestError(refusal);
      tested = toTest;
    }

    if (req.body.dryRun) {
      return {
        dataSource: toDataSourceApiInterface({
          ...datasource,
          settings: checked.settings ?? merged.settings,
        }),
        changed: true,
      };
    }

    try {
      // Already tested above, so the save doesn't run the queries again. The
      // guard keeps a save that landed since the read from being overwritten.
      await updateDataSource(context, datasource, updates, {
        skipExposureQueryValidation: true,
        guard: { dateUpdated: datasource.dateUpdated ?? null },
      });
    } catch (e) {
      if (e instanceof ConflictError && attempt < MAX_SAVE_ATTEMPTS) continue;
      throw e;
    }
    const saved = await getDataSourceById(context, datasource.id);
    return {
      dataSource: toDataSourceApiInterface(saved ?? datasource),
      changed: true,
    };
  }
});
