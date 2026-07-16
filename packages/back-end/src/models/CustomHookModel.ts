import {
  ApiCustomHook,
  CustomHookInterface,
  CustomHookType,
  customHookValidator,
  hookEntityType,
} from "shared/validators";
import { getConfigAncestorKeys } from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { MakeModelClass } from "./BaseModel";

// Whether a hook applies to the entity being validated. Entity-scoped hooks
// (feature/config) match by their exact `entityId`; a config-scoped hook also
// matches every descendant of `entityId` (any target whose `ancestorIds`
// include it). Global/project hooks (no entityType) match by project (empty
// projects = all). Callers pre-filter by `hook` type, so an entity-scoped match
// can only ever be the correct entity type. Pure + exported for unit testing.
export function customHookMatchesScope(
  hook: Pick<CustomHookInterface, "entityType" | "entityId" | "projects">,
  target: { entityId?: string; project?: string; ancestorIds?: string[] },
): boolean {
  if (hook.entityType && hook.entityId) {
    if (hook.entityId === target.entityId) return true;
    return (target.ancestorIds ?? []).includes(hook.entityId);
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
  // Execution bookkeeping shouldn't bump dateUpdated or emit an audit event
  // per hook run.
  skipDateUpdatedFields: ["lastSuccess", "lastFailure"],
  skipAuditLogFields: ["lastSuccess", "lastFailure"],
});

export class CustomHookModel extends BaseClass {
  private featureRef(doc: CustomHookInterface): FeatureInterface | null {
    if (doc.entityType !== "feature" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).feature ?? null;
  }

  private experimentRef(doc: CustomHookInterface): ExperimentInterface | null {
    if (doc.entityType !== "experiment" || !doc.entityId) return null;
    return this.getForeignRefs(doc, false).experiment ?? null;
  }

  // Config-scoped hooks fall through to the generic `canCreate/Update/Delete
  // CustomHook` gates below (org-level `manageCustomHooks`) rather than a
  // per-config permission: configs aren't a `getForeignRefs` type, so a
  // per-config check can't run in these synchronous permission methods. Managing
  // sandboxed hooks is an org-level operation, so this is a deliberate (safe)
  // simplification vs the feature-scoped `canManageFeatureCustomHooks` path.

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
    // The scope is editable, so a retarget must be permitted against BOTH the
    // old and new target (it removes validation from one resource and adds it
    // to another). When the scope doesn't change this is a single check.
    const canManage = (doc: CustomHookInterface): boolean => {
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
      return this.context.permissions.canUpdateCustomHook(existing, newDoc);
    };
    return canManage(existing) && canManage(newDoc);
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
  protected async customValidation(
    doc: CustomHookInterface,
    previousDoc?: CustomHookInterface,
  ) {
    const entityType = doc.entityType ?? null;
    // An empty entityId would pass the pairing check below but fail entity
    // matching, silently degrading the hook to project scope with projects: []
    // — i.e. matching everything. Treat it as absent so the pairing check fires.
    const entityId =
      (doc.entityId ?? null) === "" ? null : (doc.entityId ?? null);

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

    // Entity-scoped hooks derive their scope from the entity alone; stray
    // projects would silently narrow the permission checks.
    if (entityType !== null && doc.projects.length) {
      throw new Error("Entity-scoped custom hooks cannot set projects");
    }

    // Only verify entity existence when the scope is being set or retargeted —
    // otherwise a hook pinned to a since-deleted entity could never be
    // disabled, renamed, or cleaned up.
    const scopeChanged =
      !previousDoc ||
      (previousDoc.entityType ?? null) !== entityType ||
      (previousDoc.entityId ?? null) !== entityId;
    if (!scopeChanged) return;

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

    if (entityType === "experiment" && this.experimentRef(doc) === null) {
      throw new Error(`Could not find experiment for custom hook: ${entityId}`);
    }
  }

  public toApiInterface(hook: CustomHookInterface): ApiCustomHook {
    return {
      id: hook.id,
      name: hook.name,
      hook: hook.hook,
      code: hook.code,
      enabled: hook.enabled,
      projects: hook.projects,
      // `?? undefined`: raw Mongo docs can carry nulls the interface types as
      // absent — normalize so responses omit the keys instead of emitting null.
      entityType: hook.entityType ?? undefined,
      entityId: hook.entityId ?? undefined,
      incrementalChangesOnly: hook.incrementalChangesOnly ?? undefined,
      lastSuccess: hook.lastSuccess?.toISOString(),
      lastFailure: hook.lastFailure?.toISOString(),
      dateCreated: hook.dateCreated.toISOString(),
      dateUpdated: hook.dateUpdated.toISOString(),
    };
  }

  public async getByHook(
    hook: CustomHookType,
    project: string = "",
    entityId: string = "",
    // The target config's staged immediate bases, when the hook type targets
    // configs. A config-scoped hook matches the lineage the write is about to
    // create, so a re-parenting publish is judged by the family it's entering.
    // Falls back to the stored config's bases.
    configBases?: { parent?: string; extends?: string[] },
  ) {
    const hooks = await this._find({ hook, enabled: true });

    // The ancestor walk reads the whole config collection — only pay for it
    // when a config-scoped hook could match this target as a descendant.
    let ancestorIds: string[] | undefined;
    const needsAncestors = hooks.some(
      (h) => h.entityType === "config" && h.entityId && h.entityId !== entityId,
    );
    if (needsAncestors) {
      const all = await this.context.models.configs.getAllForReconcile();
      const byKey = new Map(all.map((c) => [c.key, c]));
      ancestorIds = [
        ...getConfigAncestorKeys(
          configBases ?? byKey.get(entityId) ?? {},
          byKey,
        ),
      ];
    }

    return hooks.filter((h) =>
      customHookMatchesScope(h, { entityId, project, ancestorIds }),
    );
  }

  // Same as update(), but records a distinct `customHook.revert` audit event so
  // reverts stand out from ordinary edits in the history.
  public revertUpdate(
    existing: CustomHookInterface,
    updates: UpdateProps<CustomHookInterface>,
  ) {
    return this._updateOne(existing, updates, {
      auditEvent: "customHook.revert",
    });
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
