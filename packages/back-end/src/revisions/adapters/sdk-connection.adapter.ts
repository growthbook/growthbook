import { isEqual } from "lodash";
import { z } from "zod";
import {
  EditSDKConnectionParams,
  ProxyConnection,
  SDKConnectionInterface,
} from "shared/types/sdk-connection";
import { WebhookInterface } from "shared/types/webhook";
import type { ApprovalFlowConfiguration } from "shared/types/organization";
import {
  PublishFootprint,
  Revision,
  orgHasAnySdkConnectionApproval,
  getSdkConnectionGoverningRules,
  getSdkConnectionReviewRules,
  sdkConnectionPublishFootprint,
} from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
  sdkConnectionSettingsSnapshotValidator,
  sdkConnectionUpdatableFieldsSchema,
  parseSdkWebhookSnapshot,
  sdkWebhookSnapshotValidator,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  ApplyChangesResult,
  EntityRevisionAdapter,
  filterUpdatableChanges,
  revisionActionHooks,
} from "back-end/src/revisions/EntityRevisionAdapter";
import {
  editSDKConnection,
  findSDKConnectionById,
  findSDKConnectionsByIds,
} from "back-end/src/models/SdkConnectionModel";

// Loaded at call time: the validations module pulls in the services graph,
// which cycles back through revisions/index to this adapter.
type SdkConnectionValidations =
  typeof import("back-end/src/api/sdk-connections/validations");
function loadValidations(): Promise<SdkConnectionValidations> {
  return import("back-end/src/api/sdk-connections/validations");
}

const SETTINGS_ALLOWED_KEYS = Object.keys(
  sdkConnectionSettingsSnapshotValidator.shape,
);

const CONNECTION_UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(sdkConnectionUpdatableFieldsSchema.shape),
);

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  "sdkConnection",
  "sdkWebhooks",
]);

// Only the off→on transition is gated, so a connection that kept a setting from
// a lapsed plan stays editable.
const PREMIUM_SETTINGS = [
  ["encryptPayload", "encrypt-features-endpoint"],
  ["hashSecureAttributes", "hash-secure-attributes"],
  ["remoteEvalEnabled", "remote-evaluation"],
] as const;

const webhookListValidator = z.array(sdkWebhookSnapshotValidator);

// The stored composite plus the root fields the generic engine reads off a live
// entity; the settings snapshot deliberately excludes `dateUpdated`.
export type SDKConnectionLiveSnapshot = SDKConnectionRevisionSnapshot & {
  id: string;
  projects: string[];
  dateUpdated?: Date;
};

// Secrets and system fields are dropped by the key whitelist.
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

function toWebhookSnapshot(wh: WebhookInterface): SDKWebhookRevisionSnapshot {
  return {
    id: wh.id,
    name: wh.name,
    endpoint: wh.endpoint,
    httpMethod: wh.httpMethod ?? "POST",
    ...(wh.headers !== undefined && { headers: wh.headers }),
    ...(wh.payloadFormat !== undefined && { payloadFormat: wh.payloadFormat }),
    ...(wh.payloadKey !== undefined && { payloadKey: wh.payloadKey }),
    ...((wh.timeoutSeconds ?? null) !== null && {
      timeoutSeconds: wh.timeoutSeconds,
    }),
  };
}

// Callers may attach pre-fetched webhooks to the entity as `_webhooks`.
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

function toLiveSnapshot(
  connection: SDKConnectionInterface,
  sdkWebhooks: SDKWebhookRevisionSnapshot[],
): SDKConnectionLiveSnapshot {
  return {
    id: connection.id,
    projects: connection.projects ?? [],
    ...(connection.dateUpdated !== undefined && {
      dateUpdated: connection.dateUpdated,
    }),
    sdkConnection: toConnectionSettingsSnapshot(
      connection as unknown as Record<string, unknown>,
    ),
    sdkWebhooks,
  };
}

// Requires bypass in EVERY project the connection belongs to ("" when none).
function canBypassAcrossProjects(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
): boolean {
  const projects = snapshot.sdkConnection.projects?.length
    ? snapshot.sdkConnection.projects
    : [""];
  return projects.every((project) =>
    context.permissions.canBypassSDKConnectionApprovalChecks({ project }),
  );
}

function canEditSdkConnection(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
): boolean {
  return context.permissions.canUpdateSDKConnection(snapshot.sdkConnection, {});
}

function isSdkConnectionApprovalRequired(context: Context): boolean {
  return (
    context.hasPremiumFeature("require-approvals") &&
    orgHasAnySdkConnectionApproval(context.org.settings?.approvalFlows)
  );
}

// Narrower than `ReviewRequirement` so the per-rule toggles stay visible.
type SdkConnectionReviewRequirement = {
  required: boolean;
  rules: ApprovalFlowConfiguration[];
};

function sdkConnectionReviewRequirement(
  context: Context,
  revision: Revision,
): SdkConnectionReviewRequirement {
  if (!context.hasPremiumFeature("require-approvals")) {
    return { required: false, rules: [] };
  }
  const rules = getSdkConnectionReviewRules(
    context.org.settings?.approvalFlows,
    revision.target.snapshot as SDKConnectionRevisionSnapshot,
    revision.target.proposedChanges,
  );
  return { required: rules.length > 0, rules };
}

function environmentsOf(snapshot: SDKConnectionRevisionSnapshot): string[] {
  const footprint = sdkConnectionPublishFootprint(snapshot);
  return footprint.scope === "environments" ? footprint.environments : [];
}

export const sdkConnectionAdapter: EntityRevisionAdapter<SDKConnectionRevisionSnapshot> =
  {
    getModel(context: Context) {
      return {
        // Callers only read `id`, so raw connections stand in for snapshots.
        getReadScopesByIds: async (ids: string[]) => {
          if (!ids.length) return [];
          const connections = await findSDKConnectionsByIds(context, ids);
          return connections.filter((conn) =>
            context.permissions.canReadMultiProjectResource(conn.projects),
          ) as unknown as SDKConnectionRevisionSnapshot[];
        },
        getById: async (id: string) => {
          const conn = await findSDKConnectionById(context, id);
          if (!conn) return null;
          const webhooks =
            await context.models.sdkWebhooks.findAllSdkWebhooksByConnectionIds([
              id,
            ]);
          return toLiveSnapshot(conn, webhooks.map(toWebhookSnapshot));
        },
      };
    },

    buildSnapshot(
      entity: SDKConnectionRevisionSnapshot,
    ): SDKConnectionRevisionSnapshot {
      const raw = entity as unknown as Record<string, unknown>;

      // Must be idempotent: `RevisionModel.createRequest` re-runs buildSnapshot
      // on an already-built (composite) snapshot. The live root fields are
      // dropped on purpose.
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

    // Discarding another user's in-flight revision is admin-level.
    canDelete(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canBypassAcrossProjects(context, snapshot);
    },

    ...revisionActionHooks<SDKConnectionRevisionSnapshot>({
      model: "sdk-connection",
      projectsOf: (snapshot) => snapshot.sdkConnection.projects ?? [],
      envsOf: (_context, snapshot) => environmentsOf(snapshot),
    }),

    // A connection serves one environment, plus the destination on a move.
    publishFootprint(
      _context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
      proposedChanges: unknown,
    ): PublishFootprint {
      return sdkConnectionPublishFootprint(snapshot, proposedChanges);
    },

    isApprovalRequired(context: Context): boolean {
      return isSdkConnectionApprovalRequired(context);
    },

    isApprovalRequiredForRevision(
      context: Context,
      revision: Revision,
    ): boolean {
      return sdkConnectionReviewRequirement(context, revision).required;
    },

    reviewRequirementForRevision(context: Context, revision: Revision) {
      return sdkConnectionReviewRequirement(context, revision);
    },

    canBypassApproval(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      return canBypassAcrossProjects(context, snapshot);
    },

    // The defaults resolve the org's toggles by project alone; these honor the
    // rule's `environments` too.
    shouldResetReviewOnChange(
      context: Context,
      _before: Revision,
      after: Revision,
    ): boolean {
      return sdkConnectionReviewRequirement(context, after).rules.some(
        (r) => !!r.resetReviewOnChange,
      );
    },

    isAutopublishOnApprovalEnabled(
      context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
    ): boolean {
      if (!context.hasPremiumFeature("require-approvals")) return false;
      const rules = getSdkConnectionGoverningRules(
        context.org.settings?.approvalFlows,
        snapshot.sdkConnection,
      );
      return rules.length > 0 && rules.every((r) => !!r.autopublishOnApproval);
    },

    // For the generic publish paths that skip the PUT controller. Runs before
    // the merge is claimed, so a rejection leaves the draft open.
    async assertPublishable(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      desiredState: Record<string, unknown>,
    ): Promise<void> {
      if (desiredState.sdkConnection !== undefined) {
        const settings = sdkConnectionSettingsSnapshotValidator.parse(
          desiredState.sdkConnection,
        );
        const changes = filterUpdatableChanges(
          settings,
          entity.sdkConnection,
          CONNECTION_UPDATABLE_FIELDS,
        );
        if ("projects" in changes) {
          const { validateRequireProjectForSdkConnections } =
            await loadValidations();
          validateRequireProjectForSdkConnections(
            context.org,
            changes.projects as string[],
            entity.sdkConnection.projects,
          );
        }
        for (const [field, feature] of PREMIUM_SETTINGS) {
          if (changes[field] === true && !context.hasPremiumFeature(feature)) {
            throw new Error(
              `Enabling ${field} requires the "${feature}" premium feature`,
            );
          }
        }
      }

      if (desiredState.sdkWebhooks !== undefined) {
        const webhooks = webhookListValidator.parse(desiredState.sdkWebhooks);
        const proposedIds = new Set(webhooks.map((w) => w.id));
        const baselineIds = new Set(entity.sdkWebhooks.map((w) => w.id));
        const added = webhooks.filter((w) => !baselineIds.has(w.id)).length;
        if (added > 0 && !context.hasPremiumFeature("multiple-sdk-webhooks")) {
          const removed = entity.sdkWebhooks.filter(
            (w) => !proposedIds.has(w.id),
          ).length;
          const existing =
            await context.models.sdkWebhooks.countSdkWebhooksByOrg();
          if (existing - removed + added > 1) {
            throw new Error("your webhook limit has been reached");
          }
        }
      }
    },

    async applyChanges(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      changes: Record<string, unknown>,
      options?: {
        isRevert?: boolean;
        guarded?: boolean;
        onPersisted?: (result: ApplyChangesResult) => void;
      },
    ): Promise<ApplyChangesResult> {
      // Compensation restores only these, so they reflect the write, not the request.
      const persistedKeys: string[] = [];
      let written: Record<string, unknown> | null = null;
      const report = () =>
        options?.onPersisted?.({ persistedKeys: [...persistedKeys], written });

      const newSettings = changes.sdkConnection as
        | SDKConnectionSettingsRevisionSnapshot
        | undefined;
      // Older drafts may carry delivery state; parsing keeps only editable fields.
      const newWebhooks = (
        changes.sdkWebhooks as SDKWebhookRevisionSnapshot[] | undefined
      )?.map((wh) =>
        parseSdkWebhookSnapshot({ ...wh, httpMethod: wh.httpMethod ?? "POST" }),
      );
      const settingsChanges = newSettings
        ? filterUpdatableChanges(
            newSettings,
            entity.sdkConnection,
            CONNECTION_UPDATABLE_FIELDS,
          )
        : {};
      const webhooksChanged =
        newWebhooks !== undefined && !isEqual(newWebhooks, entity.sdkWebhooks);

      if (Object.keys(settingsChanges).length === 0 && !webhooksChanged) {
        // `written: null` means "ran and wrote nothing", which compensation
        // has to tell apart from "never reported".
        report();
        return { persistedKeys, written };
      }

      const connection = await findSDKConnectionById(
        context,
        entity.sdkConnection.id,
      );
      if (!connection) throw new Error("Could not find SDK Connection");
      // The write is conditioned on the landing's baseline stamp, not the
      // re-read's: a change between the two must lose the race.
      const baselineStamp = (entity as Partial<SDKConnectionLiveSnapshot>)
        .dateUpdated;

      let liveConnection: SDKConnectionInterface = connection;
      if (Object.keys(settingsChanges).length > 0) {
        // The generic move guards read the source scope only, so authorize the
        // destination here.
        if (
          !context.permissions.canUpdateSDKConnection(connection, {
            ...(settingsChanges.projects !== undefined && {
              projects: settingsChanges.projects as string[],
            }),
            ...(settingsChanges.environment !== undefined && {
              environment: settingsChanges.environment as string,
            }),
          })
        ) {
          context.permissions.throwPermissionError();
        }
        liveConnection = await editSDKConnection(
          context,
          connection,
          settingsChanges as EditSDKConnectionParams,
          options?.guarded
            ? { casOnDateUpdated: baselineStamp ?? null }
            : undefined,
        );
        persistedKeys.push("sdkConnection");
        written = toLiveSnapshot(liveConnection, entity.sdkWebhooks);
        // Report before webhooks: a webhook failure still leaves this live.
        report();
      }

      if (webhooksChanged) {
        // The model's hooks only check the global manageEventWebhooks, not the
        // env-scoped SDK-webhook permissions.
        const scope = {
          projects: entity.sdkConnection.projects,
          environment: entity.sdkConnection.environment,
        };
        if (
          !context.permissions.canCreateSDKWebhook(scope) ||
          !context.permissions.canUpdateSDKWebhook(scope) ||
          !context.permissions.canDeleteSDKWebhook(scope)
        ) {
          context.permissions.throwPermissionError();
        }

        const oldById = new Map(entity.sdkWebhooks.map((w) => [w.id, w]));
        const newById = new Map(newWebhooks.map((w) => [w.id, w]));

        for (const wh of newWebhooks) {
          if (!oldById.has(wh.id)) {
            // A stable id per draft webhook makes a retried landing skip the
            // ones an earlier, failed attempt already created.
            const id = wh.id.startsWith("temp_")
              ? `wh_${entity.sdkConnection.id}_${wh.id.slice("temp_".length)}`
              : wh.id;
            if (await context.models.sdkWebhooks.getById(id)) continue;
            await context.models.sdkWebhooks.create({
              ...context.models.sdkWebhooks.getDefaultCreateProps(
                entity.sdkConnection.id,
              ),
              id,
              name: wh.name,
              endpoint: wh.endpoint,
              httpMethod: wh.httpMethod,
              headers: wh.headers ?? "",
              ...(wh.payloadFormat !== undefined && {
                payloadFormat: wh.payloadFormat,
              }),
              ...(wh.payloadKey !== undefined && { payloadKey: wh.payloadKey }),
              ...((wh.timeoutSeconds ?? null) !== null && {
                timeoutSeconds: wh.timeoutSeconds,
              }),
            });
          }
        }

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
                timeoutSeconds: newWh.timeoutSeconds ?? null,
              });
            }
          }
        }

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

        persistedKeys.push("sdkWebhooks");
        written = toLiveSnapshot(liveConnection, newWebhooks);
        report();
      }

      return { persistedKeys, written };
    },
  };
