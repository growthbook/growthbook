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
  // For a feature-scoped hook, resolve the referenced feature synchronously
  // (BaseModel populates foreign refs before the permission hooks run).
  private featureRef(doc: CustomHookInterface): FeatureInterface | null {
    if (doc.entityType !== "feature" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).feature ?? null;
  }

  protected canCreate(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    return feature
      ? this.context.permissions.canManageFeatureCustomHooks(feature)
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
      ? this.context.permissions.canManageFeatureCustomHooks(feature)
      : this.context.permissions.canUpdateCustomHook(existing, newDoc);
  }
  protected canDelete(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    return feature
      ? this.context.permissions.canManageFeatureCustomHooks(feature)
      : this.context.permissions.canDeleteCustomHook(doc);
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
