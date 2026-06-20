import { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  RampScheduleTemplateInterface,
  rampScheduleTemplateValidator,
} from "shared/validators";
import { rampScheduleTemplateApiSpec } from "back-end/src/api/specs/ramp-schedule-template.spec";
import { MakeModelClass } from "./BaseModel";
import { migrateRampStepTriggers } from "./RampScheduleModel";

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
    const migrated = migrateRampStepTriggers(
      doc as unknown as Parameters<typeof migrateRampStepTriggers>[0],
    ) as unknown as RampScheduleTemplateInterface;
    // Legacy templates predate the `order` field — default them to 0 so they
    // keep a stable (date-created) order until the first manual reorder.
    return { ...migrated, order: migrated.order ?? 0 };
  }

  protected canRead() {
    return this.context.permissions.canViewFeatureModal(undefined);
  }
  protected canCreate() {
    return this.context.permissions.canCreateFeature({ project: undefined });
  }
  protected canUpdate(
    _existing: RampScheduleTemplateInterface,
    _updates: UpdateProps<RampScheduleTemplateInterface>,
  ) {
    return this.context.permissions.canUpdateFeature(
      { project: undefined },
      { project: undefined },
    );
  }
  protected canDelete(_existing: RampScheduleTemplateInterface) {
    return this.context.permissions.canDeleteFeature({ project: undefined });
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
    const body = rawBody as CreateProps<RampScheduleTemplateInterface> & {
      order?: number;
    };
    return { ...body, order: body.order ?? (await this.getNextOrder()) };
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
