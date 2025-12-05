import {
  CustomHookInterface,
  CustomHookType,
  customHookValidator,
} from "shared/src/validators/custom-hooks";
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
  globallyUniqueIds: false,
});

export class CustomHookModel extends BaseClass {
  protected canCreate(doc: CustomHookInterface): boolean {
    return this.context.permissions.canCreateCustomHook(doc);
  }
  protected canRead(doc: CustomHookInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canUpdate(
    existing: CustomHookInterface,
    updates: CustomHookInterface,
  ): boolean {
    return this.context.permissions.canUpdateCustomHook(existing, updates);
  }
  protected canDelete(doc: CustomHookInterface): boolean {
    return this.context.permissions.canDeleteCustomHook(doc);
  }

  public async getByHook(hook: CustomHookType, project: string = "") {
    const hooks = await this._find({ hook, enabled: true });

    // Filter by project
    // Empty projects array = all projects
    return hooks.filter(
      (h) => !h.projects.length || h.projects.includes(project),
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
