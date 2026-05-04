import {
  ApiContextualBanditQuery,
  CBAQAttribute,
  ContextualBanditQueryInterface,
  contextualBanditQueryValidator,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  contextualBanditQueryApiSpec,
  testCbaqEndpoint,
  refreshCbaqTopValuesEndpoint,
  addCbaqAttributeEndpoint,
  updateCbaqAttributeEndpoint,
  deleteCbaqAttributeEndpoint,
} from "back-end/src/api/specs/contextual-bandit-query.spec";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { validateContextualAttributesInPayload } from "back-end/src/services/stats";
import { queueCBAQTopValuesRefreshNow } from "back-end/src/jobs/refreshCBAQTopValues";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditQueryValidator,
  collectionName: "contextualbanditqueries",
  idPrefix: "cbaq_",
  auditLog: {
    entity: "contextualBanditQuery",
    createEvent: "contextualBanditQuery.create",
    updateEvent: "contextualBanditQuery.update",
    deleteEvent: "contextualBanditQuery.delete",
  },
  globallyUniquePrimaryKeys: false,
  readonlyFields: ["datasource"],
  defaultValues: {
    description: "",
    attributes: [],
  },
  apiConfig: {
    modelKey: "contextualBanditQueries",
    openApiSpec: contextualBanditQueryApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...testCbaqEndpoint,
        reqHandler: async (req) => {
          const cbaq =
            await req.context.models.contextualBanditQueries.getById(
              req.params.id,
            );
          if (!cbaq) return req.context.throwNotFoundError();
          const datasource = await getDataSourceById(
            req.context,
            cbaq.datasource,
          );
          if (!datasource) {
            return req.context.throwNotFoundError(
              "Datasource not found for CBAQ",
            );
          }
          const integration = getSourceIntegrationObject(
            req.context,
            datasource,
            true,
          );
          if (!integration.runTestQuery) {
            return {
              ok: false,
              error: "Datasource does not support runTestQuery",
            };
          }
          const sampleSize = req.body?.sampleSize ?? 1000;
          let rows: Record<string, unknown>[] = [];
          try {
            const sampleSql = `SELECT * FROM (\n${cbaq.sql}\n) cbaq_sample LIMIT ${sampleSize}`;
            const result = await integration.runTestQuery(
              sampleSql,
              [],
              "cbaqSample",
            );
            rows = result.results;
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
          const validation = validateContextualAttributesInPayload(
            cbaq.attributes.map((a) => ({
              name: a.name,
              column: a.column,
              deleted: a.deleted,
            })),
            rows,
          );
          if (!validation.ok) {
            return {
              ok: false,
              error: validation.error,
              missingColumns: validation.missingColumns,
            };
          }
          return {
            ok: true,
            nullRate: validation.warnings?.map((w) => ({
              column: w.column,
              pct: w.nullRate,
            })),
          };
        },
      }),
      defineCustomApiHandler({
        ...refreshCbaqTopValuesEndpoint,
        reqHandler: async (req) => {
          const cbaq =
            await req.context.models.contextualBanditQueries.getById(
              req.params.id,
            );
          if (!cbaq) return req.context.throwNotFoundError();
          await queueCBAQTopValuesRefreshNow({
            id: cbaq.id,
            organization: cbaq.organization,
          });
          return {
            jobId: `cbaq_topvalues_${cbaq.id}`,
            status: "running" as const,
          };
        },
      }),
      defineCustomApiHandler({
        ...addCbaqAttributeEndpoint,
        reqHandler: async (req) => {
          const cbaq =
            await req.context.models.contextualBanditQueries.getById(
              req.params.id,
            );
          if (!cbaq) return req.context.throwNotFoundError();
          const now = new Date();
          const newAttr: CBAQAttribute = {
            name: req.body.name,
            column: req.body.column,
            datatype: req.body.datatype,
            topValues: req.body.topValues ?? [],
            dateCreated: now,
            dateUpdated: now,
            deleted: false,
          };
          const existing = cbaq.attributes.find(
            (a) => a.column === newAttr.column,
          );
          if (existing) {
            return req.context.throwBadRequestError(
              `Attribute with column "${newAttr.column}" already exists`,
            );
          }
          const updated =
            await req.context.models.contextualBanditQueries.update(cbaq, {
              attributes: [...cbaq.attributes, newAttr],
            });
          return {
            contextualBanditQuery:
              req.context.models.contextualBanditQueries.toApi(updated),
          };
        },
      }),
      defineCustomApiHandler({
        ...updateCbaqAttributeEndpoint,
        reqHandler: async (req) => {
          const cbaq =
            await req.context.models.contextualBanditQueries.getById(
              req.params.id,
            );
          if (!cbaq) return req.context.throwNotFoundError();
          const idx = cbaq.attributes.findIndex(
            (a) => a.column === req.params.column,
          );
          if (idx < 0) return req.context.throwNotFoundError("Attribute not found");
          const merged: CBAQAttribute = {
            ...cbaq.attributes[idx],
            ...req.body,
            column: cbaq.attributes[idx].column,
            dateUpdated: new Date(),
          };
          const newAttrs = [...cbaq.attributes];
          newAttrs[idx] = merged;
          const updated =
            await req.context.models.contextualBanditQueries.update(cbaq, {
              attributes: newAttrs,
            });
          return {
            contextualBanditQuery:
              req.context.models.contextualBanditQueries.toApi(updated),
          };
        },
      }),
      defineCustomApiHandler({
        ...deleteCbaqAttributeEndpoint,
        reqHandler: async (req) => {
          const cbaq =
            await req.context.models.contextualBanditQueries.getById(
              req.params.id,
            );
          if (!cbaq) return req.context.throwNotFoundError();
          const idx = cbaq.attributes.findIndex(
            (a) => a.column === req.params.column,
          );
          if (idx < 0) return req.context.throwNotFoundError("Attribute not found");
          const newAttrs = [...cbaq.attributes];
          newAttrs[idx] = {
            ...newAttrs[idx],
            deleted: true,
            dateUpdated: new Date(),
          };
          const updated =
            await req.context.models.contextualBanditQueries.update(cbaq, {
              attributes: newAttrs,
            });
          return {
            contextualBanditQuery:
              req.context.models.contextualBanditQueries.toApi(updated),
          };
        },
      }),
    ],
  },
});

/**
 * CBAQs are first-class siblings to a datasource. Permissions are tied to
 * the parent datasource's `manageDatasources` permission. The base sync
 * `can*` hooks delegate to the org-level `createDatasources` permission;
 * fine-grained checks against the parent datasource happen in
 * `customValidation` (which is async) on create.
 */
export class ContextualBanditQueryModel extends BaseClass {
  protected canRead(_doc: ContextualBanditQueryInterface): boolean {
    return this.context.hasPermission("readData", []);
  }

  protected canCreate(_doc: ContextualBanditQueryInterface): boolean {
    return this.context.permissions.canCreateDataSource({
      projects: [],
      type: undefined,
    });
  }

  protected canUpdate(
    existing: ContextualBanditQueryInterface,
  ): boolean {
    return this.context.permissions.canCreateDataSource({
      projects: [],
      type: undefined,
    });
  }

  protected canDelete(existing: ContextualBanditQueryInterface): boolean {
    return this.context.permissions.canCreateDataSource({
      projects: [],
      type: undefined,
    });
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("contextual-bandits");
  }

  protected async customValidation(
    doc: ContextualBanditQueryInterface,
    previousDoc?: ContextualBanditQueryInterface,
  ) {
    if (!previousDoc) {
      const ds = await getDataSourceById(this.context, doc.datasource);
      if (!ds) {
        throw new Error(
          `Datasource ${doc.datasource} not found in this organization`,
        );
      }
    }
  }

  public async getByDatasourceId(
    datasourceId: string,
  ): Promise<ContextualBanditQueryInterface[]> {
    return this._find({ datasource: datasourceId });
  }

  public async getByOrgAndId(
    id: string,
  ): Promise<ContextualBanditQueryInterface | null> {
    return this.getById(id);
  }

  /**
   * Public escape hatch so the spec-based custom API handlers (defined in
   * the same module's `apiConfig`) can serialize a CBAQ to its API shape
   * without poking at the protected `toApiInterface` member directly.
   */
  public toApi(doc: ContextualBanditQueryInterface): ApiContextualBanditQuery {
    return this.toApiInterface(doc);
  }

  protected toApiInterface(
    doc: ContextualBanditQueryInterface,
  ): ApiContextualBanditQuery {
    return {
      id: doc.id,
      datasourceId: doc.datasource,
      name: doc.name,
      description: doc.description,
      identifierType: doc.identifierType,
      sql: doc.sql,
      attributes: doc.attributes.map((attr) => ({
        name: attr.name,
        column: attr.column,
        datatype: attr.datatype,
        topValues: attr.topValues,
        topValuesDate: attr.topValuesDate?.toISOString(),
        dateCreated: attr.dateCreated.toISOString(),
        dateUpdated: attr.dateUpdated.toISOString(),
        deleted: attr.deleted,
      })),
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
    };
  }
}
