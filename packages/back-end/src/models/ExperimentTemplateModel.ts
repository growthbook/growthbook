import {
  ApiExperimentTemplateInterface,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  experimentTemplateApiSpec,
  bulkImportExperimentTemplatesEndpoint,
} from "back-end/src/api/specs/experiment-template.spec";
import { MakeModelClass } from "./BaseModel";

const ID_PREFIX = "tmplt__";

// The API accepts a grouped `exposureQuery: { id, identifierType }` object that
// supersedes the deprecated flat exposureQueryId/exposureQueryIdentifierType.
// The internal model stays flat, so project the object onto the flat fields
// before it reaches the model. The object and the deprecated fields are
// mutually exclusive.
function normalizeTemplateExposureQueryBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as {
    exposureQuery?: { id: string; identifierType: string };
    exposureQueryId?: string;
    exposureQueryIdentifierType?: string;
  };
  if (!b.exposureQuery) return body;
  if (
    b.exposureQueryId !== undefined ||
    b.exposureQueryIdentifierType !== undefined
  ) {
    throw new Error(
      "Cannot set exposureQuery together with the deprecated exposureQueryId or exposureQueryIdentifierType",
    );
  }
  const { exposureQuery, ...rest } = b;
  return {
    ...rest,
    exposureQueryId: exposureQuery.id,
    exposureQueryIdentifierType: exposureQuery.identifierType,
  };
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
              const created =
                await req.context.models.experimentTemplates.create({
                  ...normalizedData,
                  id: normalizedId,
                  owner: "", // Will be inferred in BaseModel if possible
                  // exposureQueryId presence is enforced by the model's Zod
                  // schema at write time; the API body types it optional
                  // because the grouped exposureQuery object is an alternative.
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

  protected override async processApiCreateBody(rawBody: unknown) {
    return super.processApiCreateBody(
      normalizeTemplateExposureQueryBody(rawBody),
    );
  }

  protected override async processApiUpdateBody(rawBody: unknown) {
    return super.processApiUpdateBody(
      normalizeTemplateExposureQueryBody(rawBody),
    );
  }

  protected override toApiInterface(
    doc: ExperimentTemplateInterface,
  ): ApiExperimentTemplateInterface {
    const base = super.toApiInterface(doc) as ApiExperimentTemplateInterface;
    return {
      ...base,
      exposureQuery:
        doc.exposureQueryId && doc.exposureQueryIdentifierType
          ? {
              id: doc.exposureQueryId,
              identifierType: doc.exposureQueryIdentifierType,
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
