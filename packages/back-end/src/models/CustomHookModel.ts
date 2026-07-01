import {
  CustomHookInterface,
  CustomHookType,
  customHookValidator,
  hookEntityType,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { FeatureInterface } from "shared/types/feature";
import { MakeModelClass } from "./BaseModel";

// Whether a hook applies to the entity being validated. Entity-scoped hooks
// (feature/config) match by their exact `entityId`; global/project hooks (no
// entityType) match by project (empty projects = all). Callers pre-filter by
// `hook` type, so an entity-scoped match can only ever be the correct entity
// type. Pure + exported for unit testing.
export function customHookMatchesScope(
  hook: Pick<CustomHookInterface, "entityType" | "entityId" | "projects">,
  target: { entityId?: string; project?: string },
): boolean {
  if (hook.entityType && hook.entityId) {
    return hook.entityId === target.entityId;
  }
  return !hook.projects.length || hook.projects.includes(target.project ?? "");
}

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

  // Config-scoped hooks fall through to the generic `canCreate/Update/Delete
  // CustomHook` gates below (org-level `manageCustomHooks`) rather than a
  // per-config permission: configs aren't a `getForeignRefs` type, so a
  // per-config check can't run in these synchronous permission methods. Managing
  // sandboxed hooks is an org-level operation, so this is a deliberate (safe)
  // simplification vs the feature-scoped `canManageFeatureCustomHooks` path.

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

    // Configs are scoped by their org-unique `key`.
    if (entityType === "config" && entityId) {
      const config = await this.context.models.configs.getByKey(entityId);
      if (!config) {
        throw new Error(`Could not find config for custom hook: ${entityId}`);
      }
    }
  }

  public async getByHook(
    hook: CustomHookType,
    project: string = "",
    entityId: string = "",
  ) {
    const hooks = await this._find({ hook, enabled: true });
    return hooks.filter((h) =>
      customHookMatchesScope(h, { entityId, project }),
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
