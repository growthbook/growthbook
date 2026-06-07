import {
  CustomHookInterface,
  CustomHookType,
  customHookValidator,
  hookEntityType,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
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
  // Scope is locked at creation. Retargeting a hook is not allowed — duplicate
  // instead. This also keeps the permission checks below unambiguous.
  readonlyFields: ["entityType", "entityId"],
});

export class CustomHookModel extends BaseClass {
  private allowPerFeatureHooks(): boolean {
    return !!this.context.org.settings?.allowPerFeatureCustomHooks;
  }

  // For a feature-scoped hook, resolve the referenced feature synchronously
  // (BaseModel populates foreign refs before the permission hooks run).
  private featureRef(doc: CustomHookInterface): FeatureInterface | null {
    if (doc.entityType !== "feature" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).feature ?? null;
  }

  protected canCreate(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    return feature
      ? this.context.permissions.canManageFeatureCustomHooks(
          feature,
          this.allowPerFeatureHooks(),
        )
      : this.context.permissions.canCreateCustomHook(doc);
  }
  protected canRead(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    return feature
      ? this.context.permissions.canReadSingleProjectResource(feature.project)
      : this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canUpdate(
    existing: CustomHookInterface,
    _updates: UpdateProps<CustomHookInterface>,
    newDoc: CustomHookInterface,
  ): boolean {
    // entityType/entityId are readonly, so the scope can't change on update.
    const feature = this.featureRef(newDoc);
    return feature
      ? this.context.permissions.canManageFeatureCustomHooks(
          feature,
          this.allowPerFeatureHooks(),
        )
      : this.context.permissions.canUpdateCustomHook(existing, newDoc);
  }
  protected canDelete(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    return feature
      ? this.context.permissions.canManageFeatureCustomHooks(
          feature,
          this.allowPerFeatureHooks(),
        )
      : this.context.permissions.canDeleteCustomHook(doc);
  }

  // Ensure a hook's entityType matches the resource its hook type operates on
  // (e.g. a validateFeature hook can only be scoped to a feature).
  protected async customValidation(doc: CustomHookInterface) {
    if (doc.entityType && doc.entityType !== hookEntityType[doc.hook]) {
      throw new Error(
        `A ${doc.hook} hook cannot be scoped to a ${doc.entityType}`,
      );
    }
  }

  public async getByHook(
    hook: CustomHookType,
    project: string = "",
    featureId: string = "",
  ) {
    const hooks = await this._find({ hook, enabled: true });

    // Feature-scoped hooks (entityType/entityId set) only run for their target
    // feature. Otherwise filter by project (empty projects array = all).
    return hooks.filter((h) =>
      h.entityType === "feature" && h.entityId
        ? h.entityId === featureId
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
