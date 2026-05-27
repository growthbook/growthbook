import { isEqual } from "lodash";
import {
  EditSDKConnectionParams,
  ProxyConnection,
} from "shared/types/sdk-connection";
import {
  Revision,
  getApprovalFlowSettings,
  isSdkConnectionRevisionMetadataOnly,
} from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  sdkConnectionSnapshotValidator,
  sdkConnectionUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import {
  editSDKConnection,
  findSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";

// Whitelist of keys the snapshot is allowed to carry, derived from the schema
// so the two can't drift. The snapshot validator runs in `.strict()` mode, so
// any leftover field on the stored entity would otherwise fail validation.
const SNAPSHOT_ALLOWED_KEYS = Object.keys(sdkConnectionSnapshotValidator.shape);

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(sdkConnectionUpdatableFieldsSchema.shape),
);

// Project a live SDK connection (or an already-flattened snapshot) into the
// flattened, secret-free revision snapshot shape:
//   - `proxy` is flattened to `proxyEnabled` / `proxyHost` so it lines up with
//     the EditSDKConnectionParams the merge step ultimately writes.
//   - secret/system fields (encryptionKey, key, proxy signing key, connected,
//     managedBy) are dropped by the key whitelist.
//   - nullish optional fields are dropped.
function toSnapshot(
  entity: Record<string, unknown>,
): SDKConnectionRevisionSnapshot {
  const proxy = entity.proxy as ProxyConnection | undefined;
  const source: Record<string, unknown> = {
    ...entity,
    proxyEnabled: proxy ? proxy.enabled : entity.proxyEnabled,
    proxyHost: proxy ? proxy.host : entity.proxyHost,
  };
  const snapshot: Record<string, unknown> = {};
  for (const key of SNAPSHOT_ALLOWED_KEYS) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    snapshot[key] = value;
  }
  return snapshot as unknown as SDKConnectionRevisionSnapshot;
}

// User must be able to bypass approval in EVERY project the connection belongs
// to (treats the empty-projects case as the global "" project). Used both for
// the bypass-approval gate and for non-author revision deletion, since
// discarding someone else's in-flight revision is an admin-level action.
function canBypassAcrossProjects(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
): boolean {
  const projects = snapshot.projects?.length ? snapshot.projects : [""];
  return projects.every((project) =>
    context.permissions.canBypassApprovalChecks({ project }),
  );
}

// canCreate and canUpdate both gate on the connection edit permission; extract
// so the two stay in sync.
function canEditSdkConnection(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
): boolean {
  return context.permissions.canUpdateSDKConnection(snapshot, {});
}

function isSdkConnectionApprovalRequired(context: Context): boolean {
  return (
    context.hasPremiumFeature("require-approvals") &&
    !!context.org.settings?.approvalFlows?.sdkConnections?.[0]?.required
  );
}

export const sdkConnectionAdapter: EntityRevisionAdapter<SDKConnectionRevisionSnapshot> =
  {
    getModel(context: Context) {
      return {
        getById: async (id: string) => {
          const conn = await findSDKConnectionById(context, id);
          return conn
            ? toSnapshot(conn as unknown as Record<string, unknown>)
            : null;
        },
      };
    },

    buildSnapshot(
      entity: SDKConnectionRevisionSnapshot,
    ): SDKConnectionRevisionSnapshot {
      return toSnapshot(entity as unknown as Record<string, unknown>);
    },

    isRevisionRequired(context: Context): boolean {
      return isSdkConnectionApprovalRequired(context);
    },

    getUpdatableFields(): ReadonlySet<string> {
      return UPDATABLE_FIELDS;
    },

    canRead(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return context.permissions.canReadMultiProjectResource(snapshot.projects);
    },

    canCreate(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canEditSdkConnection(context, snapshot);
    },

    canUpdate(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canEditSdkConnection(context, snapshot);
    },

    // Gates non-author deletion of a revision document (authors can always delete
    // their own — see RevisionModel.canDelete). Restricted to bypass-capable
    // users, since discarding another user's in-flight revision is admin-level.
    canDelete(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canBypassAcrossProjects(context, snapshot);
    },

    isApprovalRequired(context: Context): boolean {
      return isSdkConnectionApprovalRequired(context);
    },

    // Per-revision gate: when the org has approval enabled but disabled the
    // `requireMetadataReview` toggle, a revision whose proposed changes only
    // touch metadata (the name) can skip review. Mirrors the metadata-only
    // autoPublish shortcut in PUT /sdk-connections/:id so the generic
    // /revision/:id/merge endpoint reaches the same conclusion.
    isApprovalRequiredForRevision(
      context: Context,
      revision: Revision,
    ): boolean {
      if (!context.hasPremiumFeature("require-approvals")) return false;

      const settings = getApprovalFlowSettings(
        context.org.settings?.approvalFlows,
        "sdk-connection",
      );
      if (!settings?.required) return false;
      const metadataReviewRequired = settings.requireMetadataReview ?? true;
      if (metadataReviewRequired) return true;
      return !isSdkConnectionRevisionMetadataOnly(
        revision.target.proposedChanges,
      );
    },

    canBypassApproval(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canBypassAcrossProjects(context, snapshot);
    },

    // SDK connections have no revert-specific validation to relax, so the
    // `options.isRevert` flag is intentionally not used here.
    async applyChanges(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      changes: Record<string, unknown>,
    ): Promise<void> {
      // Filter to updatable fields and only include fields that actually differ.
      const filteredChanges: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) {
        if (!UPDATABLE_FIELDS.has(key)) continue;
        const newVal = changes[key];
        const currentVal = (entity as Record<string, unknown>)[key];
        if (newVal !== undefined && !isEqual(newVal, currentVal)) {
          filteredChanges[key] = newVal;
        }
      }

      if (Object.keys(filteredChanges).length === 0) return;

      // The snapshot is a flattened, secret-free projection; reload the full
      // connection so editSDKConnection has the nested proxy and secret fields
      // it needs to operate.
      const connection = await findSDKConnectionById(context, entity.id);
      if (!connection) {
        throw new Error("Could not find SDK Connection");
      }
      await editSDKConnection(
        context,
        connection,
        filteredChanges as EditSDKConnectionParams,
      );
    },
  };
