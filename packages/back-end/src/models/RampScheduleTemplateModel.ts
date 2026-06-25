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
  // entityType is fixed at creation: it determines the permission tier and the
  // allowed step-action kind, so flipping it post-create would bypass the
  // create-time permission check.
  readonlyFields: ["entityType"],
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
    // Drop fields that no longer live on templates. `rampBehavior` was removed;
    // `endStrategy` (EDF shipping automation) belongs to the experiment, not the
    // template. `entityType` is preserved — templates may target experiments as
    // well as features.
    const raw = legacyDoc as Record<string, unknown> | null;
    if (raw) {
      delete raw.rampBehavior;
      delete raw.endStrategy;
    }
    const doc = raw as RampScheduleTemplateInterface;
    const migrated = migrateRampStepTriggers(
      doc as unknown as Parameters<typeof migrateRampStepTriggers>[0],
    ) as unknown as RampScheduleTemplateInterface;
    // Legacy templates predate the `order` field — default them to 0 so they
    // keep a stable (date-created) order until the first manual reorder.
    return { ...migrated, order: migrated.order ?? 0 };
  }

  // Templates with no entityType predate the discriminator and are features.
  private isExperimentTemplate(doc: {
    entityType?: RampScheduleTemplateInterface["entityType"];
  }) {
    return doc.entityType === "experiment";
  }

  // Enforce the entityType ⟺ step-action-kind invariant (the discriminated
  // union in the schema can't express this cross-field constraint, and a
  // schema-level superRefine would be stripped by BaseModel's create/update
  // `.omit()`).
  protected async customValidation(doc: RampScheduleTemplateInterface) {
    const allowed = this.isExperimentTemplate(doc)
      ? "experiment"
      : "feature-rule";
    for (const step of doc.steps ?? []) {
      for (const action of step.actions ?? []) {
        if (action.targetType !== allowed) {
          throw new Error(
            `A ${
              doc.entityType ?? "feature"
            } ramp template may only contain ${allowed} step actions.`,
          );
        }
      }
    }
  }

  protected canRead(doc: RampScheduleTemplateInterface) {
    return this.isExperimentTemplate(doc)
      ? this.context.permissions.canViewExperimentModal(undefined)
      : this.context.permissions.canViewFeatureModal(undefined);
  }
  protected canCreate(doc: RampScheduleTemplateInterface) {
    return this.isExperimentTemplate(doc)
      ? this.context.permissions.canCreateExperiment({ project: undefined })
      : this.context.permissions.canCreateFeature({ project: undefined });
  }
  protected canUpdate(
    existing: RampScheduleTemplateInterface,
    _updates: UpdateProps<RampScheduleTemplateInterface>,
  ) {
    return this.isExperimentTemplate(existing)
      ? this.context.permissions.canUpdateExperiment(
          { project: undefined },
          { project: undefined },
        )
      : this.context.permissions.canUpdateFeature(
          { project: undefined },
          { project: undefined },
        );
  }
  protected canDelete(existing: RampScheduleTemplateInterface) {
    return this.isExperimentTemplate(existing)
      ? this.context.permissions.canDeleteExperiment({ project: undefined })
      : this.context.permissions.canDeleteFeature({ project: undefined });
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

  // `order` is unique per entityType — feature and experiment templates are
  // shown and reordered in separate lists, so each maintains its own 0..n.
  private entityTypeOf(
    t: RampScheduleTemplateInterface,
  ): "feature" | "experiment" {
    return t.entityType ?? "feature";
  }

  // Order to assign a newly created template so it lands at the end of its
  // entityType's list.
  public async getNextOrder(
    entityType: "feature" | "experiment" = "feature",
  ): Promise<number> {
    const all = await this.getAll();
    return (
      all
        .filter((t) => this.entityTypeOf(t) === entityType)
        .reduce((max, t) => Math.max(max, t.order), -1) + 1
    );
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
    return {
      ...body,
      order: body.order ?? (await this.getNextOrder(body.entityType)),
    };
  }

  // Move `oldId` into the slot held by `newId`, then renumber so `order`
  // matches array position. Reordering is scoped to the moved template's
  // entityType (each type keeps its own 0..n), so `newId` must be the same
  // type. Returns that type's reordered list, or null if either id is missing
  // or they're different types.
  public async reorder(
    oldId: string,
    newId: string,
  ): Promise<RampScheduleTemplateInterface[] | null> {
    const all = await this.getAllSorted();
    const moved = all.find((t) => t.id === oldId);
    if (!moved) return null;
    const entityType = this.entityTypeOf(moved);
    const sorted = all.filter((t) => this.entityTypeOf(t) === entityType);

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
