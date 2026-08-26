import { isEqual } from "lodash";
import {
  EditSDKConnectionParams,
  ProxyConnection,
} from "shared/types/sdk-connection";
import { WebhookInterface } from "shared/types/webhook";
import {
  Revision,
  applyTopLevelPatchOps,
  getSdkConnectionApprovalRule,
  isSdkConnectionRevisionMetadataOnly,
  orgHasAnySdkConnectionApproval,
} from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
  sdkConnectionSettingsSnapshotValidator,
  sdkConnectionUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import {
  editSDKConnection,
  findSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";

// Whitelist of keys allowed in the settings portion of the snapshot, derived
// from the schema so the two can't drift.
const SETTINGS_ALLOWED_KEYS = Object.keys(
  sdkConnectionSettingsSnapshotValidator.shape,
);

const CONNECTION_UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(sdkConnectionUpdatableFieldsSchema.shape),
);

// Top-level updatable keys in the composite snapshot: the connection settings
// object and the webhooks array. Used by the revision merge system to filter
// ops and detect changes.
const UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  "sdkConnection",
  "sdkWebhooks",
]);

// Project a live SDK connection into the flattened, secret-free settings
// snapshot shape:
//   - `proxy` is flattened to `proxyEnabled` / `proxyHost`
//   - secret/system fields (encryptionKey, key, proxy signing key, connected,
//     managedBy) are dropped by the key whitelist
//   - nullish optional fields are dropped
function toConnectionSettingsSnapshot(
  entity: Record<string, unknown>,
): SDKConnectionSettingsRevisionSnapshot {
  const proxy = entity.proxy as ProxyConnection | undefined;
  const source: Record<string, unknown> = {
    ...entity,
    proxyEnabled: proxy ? proxy.enabled : entity.proxyEnabled,
    proxyHost: proxy ? proxy.host : entity.proxyHost,
  };
  const settings: Record<string, unknown> = {};
  for (const key of SETTINGS_ALLOWED_KEYS) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    settings[key] = value;
  }
  return settings as unknown as SDKConnectionSettingsRevisionSnapshot;
}

// Map a live webhook to its snapshot shape (no secrets / runtime state).
function toWebhookSnapshot(wh: WebhookInterface): SDKWebhookRevisionSnapshot {
  return {
    id: wh.id,
    name: wh.name,
    endpoint: wh.endpoint,
    httpMethod: wh.httpMethod ?? "POST",
    ...(wh.headers !== undefined && { headers: wh.headers }),
    ...(wh.payloadFormat !== undefined && { payloadFormat: wh.payloadFormat }),
    ...(wh.payloadKey !== undefined && { payloadKey: wh.payloadKey }),
    ...(wh.disabled !== undefined && { disabled: wh.disabled }),
  };
}

// Build the composite snapshot from a live connection entity and its webhooks.
// An entity may carry pre-fetched webhooks as `_webhooks` (attached by the
// controller before snapshot-building). If absent the array defaults to [].
function toSnapshot(
  entity: Record<string, unknown>,
  webhooks?: WebhookInterface[],
): SDKConnectionRevisionSnapshot {
  const preloaded = entity._webhooks as WebhookInterface[] | undefined;
  const whs = webhooks ?? preloaded ?? [];
  return {
    sdkConnection: toConnectionSettingsSnapshot(entity),
    sdkWebhooks: whs.map(toWebhookSnapshot),
  };
}

// User must be able to bypass approval in EVERY project the connection belongs
// to (treats the empty-projects case as the global "" project). Used both for
// the bypass-approval gate and for non-author revision deletion.
function canBypassAcrossProjects(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
): boolean {
  const projects = snapshot.sdkConnection.projects?.length
    ? snapshot.sdkConnection.projects
    : [""];
  return projects.every((project) =>
    context.permissions.canBypassApprovalChecks({ project }),
  );
}

// canCreate and canUpdate both gate on the connection edit permission.
function canEditSdkConnection(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
): boolean {
  return context.permissions.canUpdateSDKConnection(snapshot.sdkConnection, {});
}

// Type-level check: does the org use SDK-connection approvals at all?
function isSdkConnectionApprovalRequired(context: Context): boolean {
  return (
    context.hasPremiumFeature("require-approvals") &&
    orgHasAnySdkConnectionApproval(context.org.settings?.approvalFlows)
  );
}

export const sdkConnectionAdapter: EntityRevisionAdapter<SDKConnectionRevisionSnapshot> =
  {
    getModel(context: Context) {
      return {
        getById: async (id: string) => {
          const conn = await findSDKConnectionById(context, id);
          if (!conn) return null;
          const webhooks =
            await context.models.sdkWebhooks.findAllSdkWebhooksByConnectionIds([
              id,
            ]);
          return toSnapshot(
            conn as unknown as Record<string, unknown>,
            webhooks,
          );
        },
      };
    },

    buildSnapshot(
      entity: SDKConnectionRevisionSnapshot,
    ): SDKConnectionRevisionSnapshot {
      const raw = entity as unknown as Record<string, unknown>;

      // Must be idempotent: `RevisionModel.createRequest` re-runs buildSnapshot
      // on an already-built snapshot to strip legacy fields. Every other
      // adapter's snapshot *is* its entity, so a second pass is a no-op there —
      // but this snapshot is composite, so re-reading it as a live connection
      // would look for `id`/`name`/... at the root and produce an empty
      // `sdkConnection`. Re-clean the nested settings instead.
      if (raw && typeof raw === "object" && "sdkConnection" in raw) {
        return {
          sdkConnection: toConnectionSettingsSnapshot(
            (raw.sdkConnection ?? {}) as Record<string, unknown>,
          ),
          sdkWebhooks: (raw.sdkWebhooks ?? []) as SDKWebhookRevisionSnapshot[],
        };
      }

      return toSnapshot(raw);
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
      return context.permissions.canReadMultiProjectResource(
        snapshot.sdkConnection.projects,
      );
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

    // Gates non-author deletion of a revision. Restricted to bypass-capable
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

    // Per-revision gate. Checks both the baseline and proposed scopes so a
    // revision that moves the connection into (or out of) a gated scope is
    // still reviewed. Metadata-only (name-only) changes can skip review when
    // the matched rule has `requireMetadataReview` disabled.
    isApprovalRequiredForRevision(
      context: Context,
      revision: Revision,
    ): boolean {
      if (!context.hasPremiumFeature("require-approvals")) return false;

      const approvalFlows = context.org.settings?.approvalFlows;
      const baseline = revision.target
        .snapshot as SDKConnectionRevisionSnapshot;
      const proposed = applyTopLevelPatchOps(
        baseline as unknown as Record<string, unknown>,
        revision.target.proposedChanges,
      ) as unknown as SDKConnectionRevisionSnapshot;

      const rule =
        getSdkConnectionApprovalRule(approvalFlows, baseline.sdkConnection) ??
        getSdkConnectionApprovalRule(approvalFlows, proposed.sdkConnection);
      if (!rule) return false;

      const metadataReviewRequired = rule.requireMetadataReview ?? true;
      if (metadataReviewRequired) return true;
      return !isSdkConnectionRevisionMetadataOnly(
        revision.target.proposedChanges,
        baseline as unknown as Record<string, unknown>,
      );
    },

    canBypassApproval(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canBypassAcrossProjects(context, snapshot);
    },

    // SDK connections have no revert-specific validation to relax.
    async applyChanges(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      changes: Record<string, unknown>,
    ): Promise<void> {
      const newSettings = changes.sdkConnection as
        | SDKConnectionSettingsRevisionSnapshot
        | undefined;
      const newWebhooks = changes.sdkWebhooks as
        | SDKWebhookRevisionSnapshot[]
        | undefined;

      // Apply connection settings changes
      if (newSettings && !isEqual(newSettings, entity.sdkConnection)) {
        const filteredChanges: Record<string, unknown> = {};
        for (const key of Object.keys(newSettings)) {
          if (!CONNECTION_UPDATABLE_FIELDS.has(key)) continue;
          const newVal = (newSettings as Record<string, unknown>)[key];
          const currentVal = (entity.sdkConnection as Record<string, unknown>)[
            key
          ];
          if (newVal !== undefined && !isEqual(newVal, currentVal)) {
            filteredChanges[key] = newVal;
          }
        }
        if (Object.keys(filteredChanges).length > 0) {
          const connection = await findSDKConnectionById(
            context,
            entity.sdkConnection.id,
          );
          if (!connection) throw new Error("Could not find SDK Connection");
          await editSDKConnection(
            context,
            connection,
            filteredChanges as EditSDKConnectionParams,
          );
        }
      }

      // Apply webhook changes
      if (newWebhooks && !isEqual(newWebhooks, entity.sdkWebhooks)) {
        const oldById = new Map(entity.sdkWebhooks.map((w) => [w.id, w]));
        const newById = new Map(newWebhooks.map((w) => [w.id, w]));

        // Create new webhooks
        for (const wh of newWebhooks) {
          if (!oldById.has(wh.id)) {
            await context.models.sdkWebhooks.create({
              ...context.models.sdkWebhooks.getDefaultCreateProps(
                entity.sdkConnection.id,
              ),
              name: wh.name,
              endpoint: wh.endpoint,
              httpMethod: wh.httpMethod,
              headers: wh.headers ?? "",
              ...(wh.payloadFormat !== undefined && {
                payloadFormat: wh.payloadFormat,
              }),
              ...(wh.payloadKey !== undefined && { payloadKey: wh.payloadKey }),
              disabled: wh.disabled ?? false,
            });
          }
        }

        // Update changed webhooks
        for (const newWh of newWebhooks) {
          const oldWh = oldById.get(newWh.id);
          if (oldWh && !isEqual(newWh, oldWh)) {
            const liveWebhook = await context.models.sdkWebhooks.getById(
              newWh.id,
            );
            if (liveWebhook) {
              await context.models.sdkWebhooks.update(liveWebhook, {
                name: newWh.name,
                endpoint: newWh.endpoint,
                httpMethod: newWh.httpMethod,
                headers: newWh.headers,
                payloadFormat: newWh.payloadFormat,
                payloadKey: newWh.payloadKey,
                disabled: newWh.disabled,
              });
            }
          }
        }

        // Delete removed webhooks
        for (const oldWh of entity.sdkWebhooks) {
          if (!newById.has(oldWh.id)) {
            const liveWebhook = await context.models.sdkWebhooks.getById(
              oldWh.id,
            );
            if (liveWebhook) {
              await context.models.sdkWebhooks.delete(liveWebhook);
            }
          }
        }
      }
    },
  };
