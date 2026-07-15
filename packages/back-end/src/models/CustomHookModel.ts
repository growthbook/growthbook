import {
  CustomHookInterface,
  CustomHookType,
  customHookValidator,
  hookEntityType,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: customHookValidator,
  collectionName: "customhooks",
  idPrefix: "hook_",
  auditLog: {
    entity: "customHook",
    createEvent: "customHook.create",
    updateEvent: "customHook.update",
    deleteEvent: "customHook.delete",
  },
  globallyUniquePrimaryKeys: false,
  // Scope is locked at creation — retarget by duplicating instead.
  readonlyFields: ["entityType", "entityId"],
});

export class CustomHookModel extends BaseClass {
  // Resolve the referenced feature synchronously (foreign refs are populated first).
  private featureRef(doc: CustomHookInterface): FeatureInterface | null {
    if (doc.entityType !== "feature" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).feature ?? null;
  }

  private experimentRef(doc: CustomHookInterface): ExperimentInterface | null {
    if (doc.entityType !== "experiment" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).experiment ?? null;
  }

  protected canCreate(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    if (feature) {
      return this.context.permissions.canManageFeatureCustomHooks(feature);
    }
    const experiment = this.experimentRef(doc);
    if (experiment) {
      return this.context.permissions.canManageExperimentCustomHooks(
        experiment,
      );
    }
    return this.context.permissions.canCreateCustomHook(doc);
  }
  protected canRead(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    if (feature) {
      return this.context.permissions.canReadSingleProjectResource(
        feature.project,
      );
    }
    const experiment = this.experimentRef(doc);
    if (experiment) {
      return this.context.permissions.canReadSingleProjectResource(
        experiment.project,
      );
    }
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canUpdate(
    existing: CustomHookInterface,
    _updates: UpdateProps<CustomHookInterface>,
    newDoc: CustomHookInterface,
  ): boolean {
    // entityType/entityId are readonly, so the scope can't change on update.
    const feature = this.featureRef(newDoc);
    if (feature) {
      return this.context.permissions.canManageFeatureCustomHooks(feature);
    }
    const experiment = this.experimentRef(newDoc);
    if (experiment) {
      return this.context.permissions.canManageExperimentCustomHooks(
        experiment,
      );
    }
    return this.context.permissions.canUpdateCustomHook(existing, newDoc);
  }
  protected canDelete(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    if (feature) {
      return this.context.permissions.canManageFeatureCustomHooks(feature);
    }
    const experiment = this.experimentRef(doc);
    if (experiment) {
      return this.context.permissions.canManageExperimentCustomHooks(
        experiment,
      );
    }
    return this.context.permissions.canDeleteCustomHook(doc);
  }

  // Ensure scoped hooks are well-formed and point at a real resource.
  protected async customValidation(doc: CustomHookInterface) {
    const entityType = doc.entityType ?? null;
    const entityId = doc.entityId ?? null;

    if ((entityType === null) !== (entityId === null)) {
      throw new Error(
        "Custom hooks must specify both entityType and entityId, or neither",
      );
    }

    if (entityType !== null && entityType !== hookEntityType[doc.hook]) {
      throw new Error(
        `A ${doc.hook} hook cannot be scoped to a ${doc.entityType}`,
      );
    }

    if (entityType === "feature" && this.featureRef(doc) === null) {
      throw new Error(`Could not find feature for custom hook: ${entityId}`);
    }

    if (entityType === "experiment" && this.experimentRef(doc) === null) {
      throw new Error(`Could not find experiment for custom hook: ${entityId}`);
    }
  }

  public async getByHook(
    hook: CustomHookType,
    project: string = "",
    entityId: string = "",
  ) {
    const hooks = await this._find({ hook, enabled: true });

    // Entity-scoped hooks match by entityId; others match by project (empty = all).
    return hooks.filter((h) =>
      h.entityType && h.entityId
        ? h.entityId === entityId
        : !h.projects.length || h.projects.includes(project),
    );
  }

  public logSuccess(hook: CustomHookInterface) {
    this.update(hook, {
      lastSuccess: new Date(),
    }).catch(() => {});
  }

  public logFailure(hook: CustomHookInterface) {
    this.update(hook, {
      lastFailure: new Date(),
    }).catch(() => {});
  }
}
