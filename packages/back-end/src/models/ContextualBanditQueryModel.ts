import { z } from "zod";
import {
  ContextualBanditQueryInterface,
  apiContextualBanditQueryValidator,
  contextualBanditQueryValidator,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  contextualBanditQueryApiSpec,
  refreshContextualBanditQueryTopValuesEndpoint,
} from "back-end/src/api/specs/contextual-bandit-query.spec";
import { refreshTopValuesForCBAQ } from "back-end/src/services/contextualBandits";
import { resolveOwnerEmail } from "back-end/src/services/owner";
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
  additionalIndexes: [
    { fields: { organization: 1, datasource: 1 } },
    { fields: { organization: 1, id: 1 } },
  ],
  defaultValues: {
    owner: "",
    description: "",
    projects: [],
    topValuesLookbackDays: 30,
  },
  apiConfig: {
    modelKey: "contextualBanditQueries",
    openApiSpec: contextualBanditQueryApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...refreshContextualBanditQueryTopValuesEndpoint,
        reqHandler: async (
          req,
        ): Promise<{
          contextualBanditQuery: z.infer<
            typeof apiContextualBanditQueryValidator
          >;
        }> => {
          const updated = await refreshTopValuesForCBAQ(
            req.context,
            req.params.id,
          );
          return {
            contextualBanditQuery: await resolveOwnerEmail(
              req.context.models.contextualBanditQueries.toApiInterfaceForResponse(
                updated,
              ),
              req.context,
            ),
          };
        },
      }),
    ],
  },
});

export class ContextualBanditQueryModel extends BaseClass {
  public toApiInterfaceForResponse(doc: ContextualBanditQueryInterface) {
    return this.toApiInterface(doc);
  }

  // Permission scope follows the datasource. We mirror the
  // metric-analysis / segment pattern: read = any user with read access
  // to any of the datasource's projects; write = createDatasources
  // permission on the same project set. The DataSource lookup is
  // intentionally per-call rather than cached on the doc because CBAQs
  // are low-volume; if A6 surfaces a hot path we can move to
  // `populateForeignRefs`.
  protected canRead(doc: ContextualBanditQueryInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canCreate(doc: ContextualBanditQueryInterface): boolean {
    return this.context.permissions.canCreateDataSource({
      projects: doc.projects,
      type: undefined,
    });
  }

  protected canUpdate(existing: ContextualBanditQueryInterface): boolean {
    return this.context.permissions.canUpdateDataSourceParams({
      projects: existing.projects,
      type: undefined,
    });
  }

  protected canDelete(existing: ContextualBanditQueryInterface): boolean {
    return this.context.permissions.canDeleteDataSource({
      projects: existing.projects,
    });
  }

  protected async customValidation(
    doc: ContextualBanditQueryInterface,
  ): Promise<void> {
    if (!doc.attributes.length) {
      throw new Error(
        "Contextual Bandit Query must define at least one attribute",
      );
    }

    // Defensive: prevent duplicate attribute keys on the same CBAQ. The
    // top-values refresh path (A3) keys cached values by attribute name,
    // so duplicates would silently overwrite each other.
    const seen = new Set<string>();
    for (const attr of doc.attributes) {
      if (seen.has(attr.attribute)) {
        throw new Error(
          `Duplicate attribute in ContextualBanditQuery: ${attr.attribute}`,
        );
      }
      seen.add(attr.attribute);
    }

    // Make sure the datasource exists in this org. We don't validate
    // type-compatibility (Postgres vs BigQuery vs …) here — A3 owns that.
    const ds = await getDataSourceById(this.context, doc.datasource);
    if (!ds) {
      throw new Error(
        `Datasource ${doc.datasource} does not exist in this organization`,
      );
    }
  }

  public async getByDatasourceId(
    datasourceId: string,
  ): Promise<ContextualBanditQueryInterface[]> {
    return this._find({ datasource: datasourceId });
  }

  public async getByIdInOrg(
    id: string,
  ): Promise<ContextualBanditQueryInterface | null> {
    return this.getById(id);
  }
}
