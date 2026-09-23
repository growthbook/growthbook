import omit from "lodash/omit";
import {
  ApiExperimentTemplateInterface,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import {
  assertValidAssignmentQuerySelection,
  parseAssignmentQueryInput,
} from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  experimentTemplateApiSpec,
  bulkImportExperimentTemplatesEndpoint,
} from "back-end/src/api/specs/experiment-template.spec";
import { getDataSourceById } from "./DataSourceModel";
import { MakeModelClass } from "./BaseModel";

const ID_PREFIX = "tmplt__";

// The API's grouped exposureQuery supersedes the deprecated exposureQueryId; the
// model stays flat.
function normalizeTemplateExposureQueryBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as {
    exposureQuery?: { id: string; identifierType: string };
    exposureQueryId?: string;
  };
  if (!b.exposureQuery) return body;
  const { id, identifierType } = parseAssignmentQueryInput(
    b.exposureQuery,
    b.exposureQueryId,
    "exposureQuery",
  );
  return {
    ...omit(b, "exposureQuery"),
    exposureQueryId: id,
    exposureQueryIdentifierType: identifierType,
  };
}

// Both fields are optional in the API body, so creates must check for one.
function assertTemplateHasExposureQuery(body: unknown) {
  const b = body as { exposureQueryId?: string } | null;
  if ((b?.exposureQueryId ?? null) === null) {
    throw new Error("exposureQuery is required");
  }
}

const BaseClass = MakeModelClass({
  schema: experimentTemplateInterface,
  collectionName: "experimenttemplates",
  idPrefix: ID_PREFIX,
  auditLog: {
    entity: "experimentTemplate",
    createEvent: "experimentTemplate.create",
    updateEvent: "experimentTemplate.update",
    deleteEvent: "experimentTemplate.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    owner: "",
    targeting: {
      condition: "{}",
    },
  },
  apiConfig: {
    modelKey: "experimentTemplates",
    openApiSpec: experimentTemplateApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...bulkImportExperimentTemplatesEndpoint,
        reqHandler: async (req) => {
          let added = 0;
          let updated = 0;
          const normalizedIds = req.body.templates.map(({ id }) =>
            id.startsWith(ID_PREFIX) ? id : `${ID_PREFIX}${id}`,
          );
          const existingTemplates =
            await req.context.models.experimentTemplates.getByIds(
              normalizedIds,
            );
          const existingById = new Map(existingTemplates.map((t) => [t.id, t]));
          // Failures mid-loop are not rolled back — earlier writes remain committed.
          // This matches the behavior of other bulk-import endpoints (e.g. /bulk-import/facts).
          // The upsert semantics make a full retry safe: already-written IDs resolve to updates.
          for (const { id, data } of req.body.templates) {
            const normalizedId = id.startsWith(ID_PREFIX)
              ? id
              : `${ID_PREFIX}${id}`;
            const existing = existingById.get(normalizedId);
            const normalizedData = normalizeTemplateExposureQueryBody(
              data,
            ) as typeof data;
            if (existing) {
              await req.context.models.experimentTemplates.update(
                existing,
                normalizedData,
              );
              updated++;
            } else {
              assertTemplateHasExposureQuery(normalizedData);
              const created =
                await req.context.models.experimentTemplates.create({
                  ...normalizedData,
                  id: normalizedId,
                  owner: "", // Will be inferred in BaseModel if possible
                } as Parameters<
                  typeof req.context.models.experimentTemplates.create
                >[0]);
              // Keep the map current so duplicate IDs in the same payload update
              // rather than attempting a second create (which would fail on the unique index).
              existingById.set(normalizedId, created);
              added++;
            }
          }
          return { added, updated };
        },
      }),
    ],
  },
});

export class ExperimentTemplatesModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: ExperimentTemplateInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: ExperimentTemplateInterface,
    _updates: UpdateProps<ExperimentTemplateInterface>,
    newDoc: ExperimentTemplateInterface,
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      newDoc,
    );
  }
  protected canDelete(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("templates");
  }

  // Runs for internal and REST writes. Only a changed selection is checked, so a
  // template whose query later drifted can still save unrelated edits.
  protected override async customValidation(
    doc: ExperimentTemplateInterface,
    previousDoc?: ExperimentTemplateInterface,
  ) {
    if (
      previousDoc &&
      previousDoc.datasource === doc.datasource &&
      previousDoc.exposureQueryId === doc.exposureQueryId &&
      (previousDoc.exposureQueryIdentifierType || null) ===
        (doc.exposureQueryIdentifierType || null) &&
      (previousDoc.project || "") === (doc.project || "")
    ) {
      return;
    }
    if (!doc.datasource || !doc.exposureQueryId) return;
    const datasource = await getDataSourceById(this.context, doc.datasource);
    if (!datasource) return;
    assertValidAssignmentQuerySelection({
      exposureQueries: datasource.settings.queries?.exposure ?? [],
      exposureQueryId: doc.exposureQueryId,
      identifierType: doc.exposureQueryIdentifierType,
      project: doc.project ?? "",
    });
  }

  protected override async processApiCreateBody(rawBody: unknown) {
    const body = normalizeTemplateExposureQueryBody(rawBody);
    assertTemplateHasExposureQuery(body);
    return super.processApiCreateBody(body);
  }

  protected override async processApiUpdateBody(rawBody: unknown) {
    return super.processApiUpdateBody(
      normalizeTemplateExposureQueryBody(rawBody),
    );
  }

  protected override toApiInterface(
    doc: ExperimentTemplateInterface,
  ): ApiExperimentTemplateInterface {
    const { exposureQueryIdentifierType, ...base } = super.toApiInterface(
      doc,
    ) as ExperimentTemplateInterface & ApiExperimentTemplateInterface;
    return {
      ...base,
      exposureQuery:
        doc.exposureQueryId && exposureQueryIdentifierType
          ? {
              id: doc.exposureQueryId,
              identifierType: exposureQueryIdentifierType,
            }
          : undefined,
    };
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiExperimentTemplateInterface[]> {
    const { projectId } = req.query;
    const docs = await (projectId
      ? this._find({ project: projectId })
      : this.getAll());
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }
}
