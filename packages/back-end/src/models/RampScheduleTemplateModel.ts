import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  ApiRampMonitoringConfig,
  ApiRampMonitoringConfigInput,
  ApiRampScheduleTemplateInterface,
  RampScheduleTemplateInterface,
  rampScheduleTemplateValidator,
} from "shared/validators";
import { rampScheduleTemplateApiSpec } from "back-end/src/api/specs/ramp-schedule-template.spec";
import { assertApiAssignmentQueryRefHasIdentifierType } from "back-end/src/services/assignmentQuerySelection";
import { MakeModelClass } from "./BaseModel";
import {
  apiMonitoringConfigToInternal,
  migrateRampStepTriggers,
  monitoringConfigToApi,
} from "./RampScheduleModel";

// Translates the API's grouped monitoringConfig.exposureQuery to the flat
// stored shape; `null` (clear) and absent pass through.
function withInternalMonitoringConfig<
  T extends { monitoringConfig?: ApiRampMonitoringConfig | null },
>(body: T) {
  if (!body.monitoringConfig) return body;
  return {
    ...body,
    monitoringConfig: apiMonitoringConfigToInternal(body.monitoringConfig),
  };
}

const BaseClass = MakeModelClass({
  schema: rampScheduleTemplateValidator,
  collectionName: "rampscheduletemplates",
  idPrefix: "rst_",
  auditLog: {
    entity: "rampScheduleTemplate",
    createEvent: "rampScheduleTemplate.create",
    updateEvent: "rampScheduleTemplate.update",
    deleteEvent: "rampScheduleTemplate.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    order: 0,
  },
  // Reordering only touches `order`; don't bump dateUpdated or emit audit logs.
  skipDateUpdatedFields: ["order"],
  skipAuditLogFields: ["order"],
  apiConfig: {
    modelKey: "rampScheduleTemplates",
    openApiSpec: rampScheduleTemplateApiSpec,
  },
});

export class RampScheduleTemplateModel extends BaseClass {
  protected migrate(legacyDoc: unknown): RampScheduleTemplateInterface {
    const doc = legacyDoc as RampScheduleTemplateInterface;
    // Templates are reusable plans, so a legacy scheduled trigger's absolute
    // date is meaningless against the template's creation time. Convert with
    // no date anchor: the first scheduled date anchors the walk, preserving
    // the plan's relative pacing (the first such step becomes ~instant).
    const migrated = {
      ...doc,
      ...(migrateRampStepTriggers({ steps: doc.steps } as Parameters<
        typeof migrateRampStepTriggers
      >[0]) as unknown as Pick<RampScheduleTemplateInterface, "steps">),
    };
    // Legacy templates predate the `order` field — default them to 0 so they
    // keep a stable (date-created) order until the first manual reorder.
    return { ...migrated, order: migrated.order ?? 0 };
  }

  protected canRead() {
    return this.context.permissions.canViewFeatureModal(undefined);
  }
  protected canCreate() {
    return this.context.permissions.canEditFeatureDrafts({
      project: undefined,
    });
  }
  protected canUpdate(
    _existing: RampScheduleTemplateInterface,
    _updates: UpdateProps<RampScheduleTemplateInterface>,
  ) {
    return this.context.permissions.canEditFeatureDrafts({
      project: undefined,
    });
  }
  protected canDelete(_existing: RampScheduleTemplateInterface) {
    return this.context.permissions.canDeleteFeature(
      { project: undefined },
      NO_ENVIRONMENT_BINDING,
    );
  }

  // Templates in manual order. Ties (e.g. legacy order=0) fall back to
  // creation time so ordering stays deterministic before any reorder.
  private sortByOrder(templates: RampScheduleTemplateInterface[]) {
    return [...templates].sort(
      (a, b) =>
        a.order - b.order || a.dateCreated.getTime() - b.dateCreated.getTime(),
    );
  }

  public async getAllSorted(): Promise<RampScheduleTemplateInterface[]> {
    return this.sortByOrder(await this.getAll());
  }

  // Order to assign a newly created template so it lands at the end.
  public async getNextOrder(): Promise<number> {
    const all = await this.getAll();
    return all.reduce((max, t) => Math.max(max, t.order), -1) + 1;
  }

  // REST create: append to the end unless the caller pins an explicit order, so
  // API-created templates behave like app-created ones instead of defaulting to
  // order 0 and jumping to the top.
  protected async processApiCreateBody(
    rawBody: unknown,
  ): Promise<CreateProps<RampScheduleTemplateInterface>> {
    await this.assertApiMonitoringIdentifierType(rawBody, null);
    const body = withInternalMonitoringConfig(
      rawBody as Omit<
        CreateProps<RampScheduleTemplateInterface>,
        "monitoringConfig"
      > & {
        order?: number;
        monitoringConfig?: ApiRampMonitoringConfig | null;
      },
    ) as CreateProps<RampScheduleTemplateInterface> & { order?: number };
    return { ...body, order: body.order ?? (await this.getNextOrder()) };
  }

  // Overridden to read the stored query, which processApiUpdateBody can't see.
  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ) {
    const { id } = req.params as { id: string };
    await this.assertApiMonitoringIdentifierType(
      req.body,
      await this.getById(id),
    );
    return super.handleApiUpdate(req);
  }

  private async assertApiMonitoringIdentifierType(
    rawBody: unknown,
    existing: RampScheduleTemplateInterface | null,
  ) {
    const mc = (
      rawBody as { monitoringConfig?: ApiRampMonitoringConfigInput | null }
    )?.monitoringConfig;
    if (!mc) return;
    await assertApiAssignmentQueryRefHasIdentifierType(this.context, {
      datasourceId: mc.datasourceId,
      ref: mc.exposureQuery,
      field: "exposureQuery",
      currentExposureQueryId: existing?.monitoringConfig?.exposureQueryId,
    });
  }

  protected async processApiUpdateBody(
    rawBody: unknown,
  ): Promise<UpdateProps<RampScheduleTemplateInterface>> {
    return withInternalMonitoringConfig(
      rawBody as Omit<
        UpdateProps<RampScheduleTemplateInterface>,
        "monitoringConfig"
      > & { monitoringConfig?: ApiRampMonitoringConfig | null },
    ) as UpdateProps<RampScheduleTemplateInterface>;
  }

  // The monitoring data source is nested, so BaseModel wouldn't cache it.
  protected getForeignKeys(doc: RampScheduleTemplateInterface) {
    const keys = super.getForeignKeys(doc);
    if (doc.monitoringConfig?.datasourceId) {
      keys.datasource = doc.monitoringConfig.datasourceId;
    }
    return keys;
  }

  protected toApiInterface(
    doc: RampScheduleTemplateInterface,
  ): ApiRampScheduleTemplateInterface {
    const base = super.toApiInterface(doc);
    return {
      ...base,
      monitoringConfig: doc.monitoringConfig
        ? monitoringConfigToApi(
            doc.monitoringConfig,
            this.getForeignRefs(doc, false).datasource?.settings?.queries
              ?.exposure ?? [],
          )
        : doc.monitoringConfig,
    };
  }

  // Move `oldId` into the slot held by `newId`, then renumber so `order`
  // matches array position. Returns the full reordered list, or null if either
  // id is missing.
  public async reorder(
    oldId: string,
    newId: string,
  ): Promise<RampScheduleTemplateInterface[] | null> {
    const sorted = await this.getAllSorted();
    const oldIndex = sorted.findIndex((t) => t.id === oldId);
    const newIndex = sorted.findIndex((t) => t.id === newId);
    if (oldIndex === -1 || newIndex === -1) return null;

    sorted.splice(newIndex, 0, sorted.splice(oldIndex, 1)[0]);

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].order !== i) {
        await this.updateById(sorted[i].id, { order: i });
        sorted[i] = { ...sorted[i], order: i };
      }
    }
    return sorted;
  }
}
