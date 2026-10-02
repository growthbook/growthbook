import {
  ApiAssignmentQueryRefInput,
  ApiExperimentTemplateInterface,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import {
  flattenExposureQueryInput,
  toApiAssignmentQueryRef,
} from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import {
  resolveOwnerEmail,
  resolveOwnerEmails,
} from "back-end/src/services/owner";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  experimentTemplateApiSpec,
  bulkImportExperimentTemplatesEndpoint,
} from "back-end/src/api/specs/experiment-template.spec";
import {
  resolveAssignmentQueryIdentifier,
  assertValidAssignmentQuerySelectionChange,
} from "back-end/src/services/assignmentQuerySelection";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { MakeModelClass } from "./BaseModel";

const ID_PREFIX = "tmplt__";

type ApiTemplateBody = {
  datasource?: string;
  exposureQuery?: ApiAssignmentQueryRefInput;
  exposureQueryId?: string;
};

/**
 * The API's grouped exposureQuery supersedes the deprecated exposureQueryId;
 * the model stays flat.
 */
async function toTemplateWriteBody<T extends ApiTemplateBody>(
  context: ReqContext | ApiReqContext,
  body: T,
  existing: ExperimentTemplateInterface | null,
) {
  const flat = flattenExposureQueryInput(body);
  if (flat.exposureQueryId === undefined) return flat;
  const { identifierType: exposureQueryIdentifierType } =
    await resolveAssignmentQueryIdentifier(context, {
      previous: existing
        ? {
            datasource: existing.datasource,
            exposureQueryId: existing.exposureQueryId,
            identifierType: existing.exposureQueryIdentifierType,
          }
        : null,
      next: {
        datasource: flat.datasource ?? existing?.datasource ?? "",
        exposureQueryId: flat.exposureQueryId,
        identifierType: flat.exposureQueryIdentifierType,
      },
      onOmitted: "requireUnambiguous",
      field: "exposureQuery",
    });
  // Always keyed: on update, undefined clears an identifier the new selection
  // doesn't use.
  return { ...flat, exposureQueryIdentifierType };
}

/** Both fields are optional in the API body, so creates must check for one. */
function withRequiredExposureQuery<T extends { exposureQueryId?: string }>(
  body: T,
): T & { exposureQueryId: string } {
  const { exposureQueryId } = body;
  if (exposureQueryId === undefined) {
    throw new Error("exposureQuery is required");
  }
  return { ...body, exposureQueryId };
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
            const normalizedData = await toTemplateWriteBody(
              req.context,
              data,
              existing ?? null,
            );
            if (existing) {
              await req.context.models.experimentTemplates.update(
                existing,
                normalizedData,
              );
              updated++;
            } else {
              const created =
                await req.context.models.experimentTemplates.create({
                  ...withRequiredExposureQuery(normalizedData),
                  id: normalizedId,
                  owner: "", // Will be inferred in BaseModel if possible
                });
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

  protected override hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("templates");
  }

  /** Runs for internal and REST writes. */
  protected override async customValidation(
    doc: ExperimentTemplateInterface,
    previousDoc?: ExperimentTemplateInterface,
  ) {
    await assertValidAssignmentQuerySelectionChange(
      this.context,
      previousDoc
        ? {
            datasource: previousDoc.datasource,
            exposureQueryId: previousDoc.exposureQueryId,
            identifierType: previousDoc.exposureQueryIdentifierType,
          }
        : null,
      {
        datasource: doc.datasource,
        exposureQueryId: doc.exposureQueryId,
        identifierType: doc.exposureQueryIdentifierType,
      },
    );
  }

  protected override async processApiCreateBody(rawBody: unknown) {
    const body = await toTemplateWriteBody(
      this.context,
      rawBody as ApiTemplateBody,
      null,
    );
    return super.processApiCreateBody(withRequiredExposureQuery(body));
  }

  /**
   * Overridden to read the stored query, which processApiUpdateBody can't see.
   */
  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ) {
    const { id } = req.params as { id: string };
    const toUpdate = (await toTemplateWriteBody(
      this.context,
      req.body,
      await this.getById(id),
    )) as UpdateProps<ExperimentTemplateInterface>;
    return resolveOwnerEmail(
      this.toApiInterface(await this.updateById(id, toUpdate)),
      this.context,
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
      exposureQuery: toApiAssignmentQueryRef(
        doc.exposureQueryId,
        exposureQueryIdentifierType,
        // BaseModel caches the template's data source on read and write.
        this.getForeignRefs(doc, false).datasource?.settings?.queries
          ?.exposure ?? [],
      ),
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
