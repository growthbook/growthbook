import {
  CustomHookInterface,
  CustomHookType,
  customHookValidator,
  hookEntityType,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { FeatureInterface } from "shared/types/feature";
import { SavedGroupInterface } from "shared/types/saved-group";
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

  // Resolve the referenced saved group synchronously (foreign refs are populated first).
  private savedGroupRef(doc: CustomHookInterface): SavedGroupInterface | null {
    if (doc.entityType !== "savedGroup" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).savedGroup ?? null;
  }

  protected canCreate(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    if (feature) {
      return this.context.permissions.canManageFeatureCustomHooks(feature);
    }
    const savedGroup = this.savedGroupRef(doc);
    if (savedGroup) {
      return this.context.permissions.canManageSavedGroupCustomHooks(
        savedGroup,
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
    const savedGroup = this.savedGroupRef(doc);
    if (savedGroup) {
      return this.context.permissions.canReadMultiProjectResource(
        savedGroup.projects,
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
    const savedGroup = this.savedGroupRef(newDoc);
    if (savedGroup) {
      return this.context.permissions.canManageSavedGroupCustomHooks(
        savedGroup,
      );
    }
    return this.context.permissions.canUpdateCustomHook(existing, newDoc);
  }
  protected canDelete(doc: CustomHookInterface): boolean {
    const feature = this.featureRef(doc);
    if (feature) {
      return this.context.permissions.canManageFeatureCustomHooks(feature);
    }
    const savedGroup = this.savedGroupRef(doc);
    if (savedGroup) {
      return this.context.permissions.canManageSavedGroupCustomHooks(
        savedGroup,
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

    if (entityType === "savedGroup" && this.savedGroupRef(doc) === null) {
      throw new Error(
        `Could not find saved group for custom hook: ${entityId}`,
      );
    }
  }

  public async getByHook(
    hook: CustomHookType,
    // A single project (features) or list of projects (saved groups).
    projects: string | string[] = "",
    entityId: string = "",
  ) {
    const hooks = await this._find({ hook, enabled: true });

    const projectList = Array.isArray(projects)
      ? projects
      : projects
        ? [projects]
        : [];

    // Scoping model (conventional narrowing):
    //   - Global hooks (empty `projects`) are universal rules: they match every
    //     resource, whatever its projects.
    //   - Project-scoped hooks add on for project-scoped resources: they match a
    //     resource only when they share at least one project with it.
    //   - A global resource (empty `projectList`) therefore runs global hooks
    //     ONLY — a project-scoped hook can never share a project with it and so
    //     never reaches it.
    // Entity-scoped hooks are exempt from project matching and match by entityId.
    return hooks.filter((h) =>
      h.entityType && h.entityId
        ? h.entityId === entityId
        : !h.projects.length || projectList.some((p) => h.projects.includes(p)),
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
