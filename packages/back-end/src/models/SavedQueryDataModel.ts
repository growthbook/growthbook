import { UpdateProps } from "shared/types/base-model";
import {
  ApiCreateSavedQueryBody,
  ApiRefreshSavedQueryReturn,
  ApiSavedQuery,
  ApiSavedQueryReturn,
  ApiUpdateSavedQueryBody,
  QueryExecutionResult,
  SavedQuery,
  savedQueryValidator,
} from "shared/validators";
import { chartTypeSupportsAnchorYAxisToZero } from "shared/enterprise";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  postSavedQueryEndpoint,
  refreshSavedQueryEndpoint,
  savedQueryApiSpec,
  updateSavedQueryEndpoint,
} from "back-end/src/api/specs/saved-query.spec";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { executeAndSaveQuery } from "back-end/src/routers/saved-queries/saved-queries.controller";
import { runFreeFormQuery } from "back-end/src/services/datasource";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { assertReadOnlySql, withVizIds } from "back-end/src/util/savedQueries";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: savedQueryValidator,
  collectionName: "savedqueries",
  idPrefix: "sq_",
  auditLog: {
    entity: "savedQuery",
    createEvent: "savedQuery.create",
    updateEvent: "savedQuery.update",
    deleteEvent: "savedQuery.delete",
  },
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
  ],
  apiConfig: {
    modelKey: "savedQueries",
    openApiSpec: savedQueryApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...postSavedQueryEndpoint,
        reqHandler: async (req): Promise<ApiSavedQueryReturn> => ({
          savedQuery: await req.context.models.savedQueries.apiCreate(req.body),
        }),
      }),
      defineCustomApiHandler({
        ...updateSavedQueryEndpoint,
        reqHandler: async (req): Promise<ApiSavedQueryReturn> => ({
          savedQuery: await req.context.models.savedQueries.apiUpdate(
            req.params.id,
            req.body,
          ),
        }),
      }),
      defineCustomApiHandler({
        ...refreshSavedQueryEndpoint,
        reqHandler: (req): Promise<ApiRefreshSavedQueryReturn> =>
          req.context.models.savedQueries.apiRefresh(req.params.id),
      }),
    ],
  },
});

export class SavedQueryDataModel extends BaseClass {
  public toApiInterface(q: SavedQuery): ApiSavedQuery {
    return {
      id: q.id,
      datasourceId: q.datasourceId,
      name: q.name,
      sql: q.sql,
      dataVizConfig: q.dataVizConfig ?? [],
      linkedDashboardIds: q.linkedDashboardIds ?? [],
      dateLastRan: q.dateLastRan.toISOString(),
      lastRun: {
        rowCount: q.results?.results?.length ?? 0,
        error: q.results?.error ?? null,
        duration: q.results?.duration ?? null,
      },
      dateCreated: q.dateCreated.toISOString(),
      dateUpdated: q.dateUpdated.toISOString(),
    };
  }

  private assertPlanAllows() {
    if (!this.context.hasPremiumFeature("saveSqlExplorerQueries")) {
      this.context.throwPlanDoesNotAllowError(
        "Your organization's plan does not support saving queries.",
      );
    }
  }

  private async findOrThrow(id: string) {
    const savedQuery = await this.getById(id);
    if (!savedQuery)
      throw new NotFoundError(`Could not find saved query ${id}.`);
    return savedQuery;
  }

  private async getForApi(id: string) {
    this.assertPlanAllows();
    return this.findOrThrow(id);
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiSavedQuery[]> {
    this.assertPlanAllows();
    const { datasourceId } = req.query;
    return (await this.getAll())
      .filter((q) => !datasourceId || q.datasourceId === datasourceId)
      .map((q) => this.toApiInterface(q));
  }

  public override async handleApiGet(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiGet"]>[0],
  ): Promise<ApiSavedQuery> {
    return this.toApiInterface(await this.getForApi(req.params.id));
  }

  public override async handleApiDelete(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiDelete"]>[0],
  ): Promise<string> {
    // No plan check, as in the app, so an org that lost the feature can clean up
    const existing = await this.findOrThrow(req.params.id);
    await this.delete(existing);
    return existing.id;
  }

  public async apiCreate(
    body: ApiCreateSavedQueryBody,
  ): Promise<ApiSavedQuery> {
    this.assertPlanAllows();
    const { datasourceId, name, sql, dataVizConfig, runNow } = body;
    assertReadOnlySql(sql);
    const datasource = await getDataSourceById(this.context, datasourceId);
    if (!datasource) {
      throw new NotFoundError(`Could not find Data Source ${datasourceId}.`);
    }
    let results: QueryExecutionResult = { results: [], sql };
    // Run before creating so a failing query is rejected rather than saved
    if (runNow !== false) {
      const run = await runFreeFormQuery(this.context, datasource, sql, 1000);
      if (run.error || !run.results) {
        throw new BadRequestError(run.error ?? "The query failed.");
      }
      results = { results: run.results, duration: run.duration, sql: run.sql };
    }
    const created = await this.create({
      datasourceId,
      name,
      sql,
      dataVizConfig: withVizIds(dataVizConfig ?? []),
      dateLastRan: new Date(),
      results,
    });
    return this.toApiInterface(created);
  }

  public async apiUpdate(
    id: string,
    body: ApiUpdateSavedQueryBody,
  ): Promise<ApiSavedQuery> {
    const existing = await this.getForApi(id);
    const { name, sql, dataVizConfig } = body;
    // Only a change is checked, so an echoed legacy query still saves
    if (sql !== undefined && sql !== existing.sql) assertReadOnlySql(sql);
    const updated = await this.update(existing, {
      ...(name !== undefined ? { name } : {}),
      ...(sql !== undefined ? { sql } : {}),
      ...(dataVizConfig ? { dataVizConfig: withVizIds(dataVizConfig) } : {}),
    });
    return this.toApiInterface(updated);
  }

  public async apiRefresh(id: string): Promise<ApiRefreshSavedQueryReturn> {
    const existing = await this.getForApi(id);
    // Queries saved in the app only had their first keyword checked
    assertReadOnlySql(existing.sql);
    const datasource = await getDataSourceById(
      this.context,
      existing.datasourceId,
    );
    if (!datasource) {
      throw new NotFoundError(
        "Could not find the Data Source for this saved query.",
      );
    }
    // Returns the run's output only when it failed; success is saved instead
    const failed = await executeAndSaveQuery(
      this.context,
      existing,
      datasource,
    );
    const saved = await this.getForApi(existing.id);
    return {
      savedQuery: this.toApiInterface(saved),
      results: saved.results?.results ?? [],
      error: failed ? (failed.error ?? "The query failed.") : null,
    };
  }

  protected migrate(legacyDoc: unknown): SavedQuery {
    const doc = legacyDoc as SavedQuery;

    // Migrate anchorYAxisToZero for line and scatter charts
    if (doc.dataVizConfig && Array.isArray(doc.dataVizConfig)) {
      doc.dataVizConfig = doc.dataVizConfig.map((config) => {
        if (!chartTypeSupportsAnchorYAxisToZero(config.chartType)) {
          // If the chart type doesn't support display settings, return the config as is
          return config;
        }

        const configWithDisplaySettings = config as typeof config & {
          displaySettings?: {
            anchorYAxisToZero?: boolean;
          };
        };
        const displaySettings = configWithDisplaySettings.displaySettings;

        // Ensure anchorYAxisToZero exists and is a boolean (default to true)
        const needsMigration =
          !displaySettings ||
          typeof displaySettings.anchorYAxisToZero !== "boolean";

        if (needsMigration) {
          return {
            ...config,
            displaySettings: {
              ...(displaySettings || {}),
              anchorYAxisToZero: true,
            },
          } as typeof config;
        }

        return config;
      });
    }

    return doc;
  }

  protected canRead(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canViewSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canCreate(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) {
      throw new Error("Datasource not found");
    }
    return this.context.permissions.canRunSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(
    existing: SavedQuery,
    updates: UpdateProps<SavedQuery>,
  ): boolean {
    // Always get the datasource from the existing object
    const { datasource: existingDatasource } = this.getForeignRefs(existing);
    if (!existingDatasource) {
      throw new Error("Existing datasource not found");
    }

    // Get the datasource from the combined object
    const { datasource: newDatasource = existingDatasource } =
      this.getForeignRefs({
        ...existing,
        ...updates,
      });

    if (!newDatasource) {
      throw new Error("New datasource not found");
    }

    return this.context.permissions.canUpdateSqlExplorerQueries(
      {
        projects: existingDatasource.projects || [],
      },
      {
        projects: newDatasource.projects || [],
      },
    );
  }
  protected canDelete(doc: SavedQuery): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canDeleteSqlExplorerQueries({
      projects: datasource?.projects || [],
    });
  }
}
