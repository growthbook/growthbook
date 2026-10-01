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
  SdkConnectionApprovalScope,
  applyTopLevelPatchOps,
  isSdkConnectionRevisionMetadataOnly,
  isSdkConnectionRevisionReviewExempt,
  orgHasAnySdkConnectionApproval,
  getSdkConnectionGoverningRules,
} from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
  sdkConnectionSettingsSnapshotValidator,
  sdkConnectionUpdatableFieldsSchema,
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
// which cycles back through revisions/index to this adapter before it has
// finished initializing (same reason saved-group.adapter defers its guard).
type SdkConnectionValidations =
  typeof import("back-end/src/api/sdk-connections/validations");
function loadValidations(): Promise<SdkConnectionValidations> {
  return import("back-end/src/api/sdk-connections/validations");
}

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

// Payload settings that need an entitlement to turn ON. Mirrors the PUT
// controller, which only gates the off→on transition so a connection that kept
// a setting from a lapsed plan stays editable.
const PREMIUM_SETTINGS = [
  ["encryptPayload", "encrypt-features-endpoint"],
  ["hashSecureAttributes", "hash-secure-attributes"],
  ["remoteEvalEnabled", "remote-evaluation"],
] as const;

const webhookListValidator = z.array(sdkWebhookSnapshotValidator);

// What `getById` returns and what a landing writes: the stored composite plus
// the root fields the generic engine reads off a live entity. `id` is what
// compensation re-reads by, `projects` is what the project-scoped authority
// checks read, and `dateUpdated` is the connection's stamp that the landing
// fences compare — the settings snapshot deliberately excludes it.
export type SDKConnectionLiveSnapshot = SDKConnectionRevisionSnapshot & {
  id: string;
  projects: string[];
  dateUpdated?: Date;
};

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

// The settings this revision lands with: the coarse `replace /sdkConnection`
// op layered on the baseline.
function settingsAfter(
  snapshot: SDKConnectionRevisionSnapshot,
  proposedChanges: unknown,
): SDKConnectionSettingsRevisionSnapshot {
  const proposed = applyTopLevelPatchOps(
    snapshot as unknown as Record<string, unknown>,
    proposedChanges,
  ) as Partial<SDKConnectionRevisionSnapshot>;
  return proposed.sdkConnection ?? snapshot.sdkConnection;
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
    context.permissions.canBypassSDKConnectionApprovalChecks({ project }),
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

// Every enabled rule whose project AND environment scope covers one of the
// given scopes. Not `getApprovalFlowRules`: that resolves by project alone and
// would fold an environment-scoped rule onto every environment.
function rulesMatchingScopes(
  context: Context,
  scopes: SdkConnectionApprovalScope[],
): ApprovalFlowConfiguration[] {
  const approvalFlows = context.org.settings?.approvalFlows;
  return [
    ...new Set(
      scopes.flatMap((scope) =>
        getSdkConnectionGoverningRules(approvalFlows, scope),
      ),
    ),
  ];
}

// The rules governing this revision, judged on both the baseline and proposed
// scopes so a revision that moves the connection into (or out of) a gated scope
// is still reviewed. A name-only change answers only to the rules that gate
// metadata.
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
  const baseline = revision.target.snapshot as SDKConnectionRevisionSnapshot;
  if (
    isSdkConnectionRevisionReviewExempt(
      revision.target.proposedChanges,
      baseline as unknown as Record<string, unknown>,
    )
  ) {
    return { required: false, rules: [] };
  }
  const rules = rulesMatchingScopes(context, [
    baseline.sdkConnection,
    settingsAfter(baseline, revision.target.proposedChanges),
  ]);
  const governing = isSdkConnectionRevisionMetadataOnly(
    revision.target.proposedChanges,
    baseline as unknown as Record<string, unknown>,
  )
    ? rules.filter((r) => r.requireMetadataReview !== false)
    : rules;
  return { required: governing.length > 0, rules: governing };
}

function environmentsOf(
  snapshot: SDKConnectionRevisionSnapshot,
  proposedChanges?: unknown,
): string[] {
  const environments = new Set([snapshot.sdkConnection.environment]);
  if (proposedChanges !== undefined) {
    environments.add(settingsAfter(snapshot, proposedChanges).environment);
  }
  return [...environments].filter((env) => !!env);
}

export const sdkConnectionAdapter: EntityRevisionAdapter<SDKConnectionRevisionSnapshot> =
  {
    getModel(context: Context) {
      return {
        // Read-filtered batch fetch used by revision listings to decide
        // visibility from the live connection rather than a stale snapshot.
        // Callers only read `id`, so the raw connections stand in for the
        // composite snapshot shape here.
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
      // on an already-built snapshot to strip legacy fields. Every other
      // adapter's snapshot *is* its entity, so a second pass is a no-op there —
      // but this snapshot is composite, so re-reading it as a live connection
      // would look for `id`/`name`/... at the root and produce an empty
      // `sdkConnection`. Re-clean the nested settings instead. The live root
      // fields (`id`, `projects`, `dateUpdated`) are dropped here on purpose:
      // the stored snapshot is the composite alone.
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

    ...revisionActionHooks<SDKConnectionRevisionSnapshot>({
      model: "sdk-connection",
      projectsOf: (snapshot) => snapshot.sdkConnection.projects ?? [],
      envsOf: (_context, snapshot) => environmentsOf(snapshot),
    }),

    // A connection serves exactly one environment, so a change reaches that
    // environment — and the destination environment when the revision moves it.
    publishFootprint(
      _context: Context,
      snapshot: SDKConnectionRevisionSnapshot,
      proposedChanges: unknown,
    ): PublishFootprint {
      return {
        scope: "environments",
        environments: environmentsOf(snapshot, proposedChanges),
      };
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
      const rules = rulesMatchingScopes(context, [snapshot.sdkConnection]);
      return rules.length > 0 && rules.every((r) => !!r.autopublishOnApproval);
    },

    // The same rules the PUT controller enforces, for the generic publish paths
    // that never pass through it. Runs before the merge is claimed, so a
    // rejection leaves the draft open.
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

    // SDK connections have no revert-specific validation to relax.
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
      // Keys this apply actually persisted. Compensation restores only these,
      // so it must reflect the write, not the request.
      const persistedKeys: string[] = [];
      let written: Record<string, unknown> | null = null;
      const report = () =>
        options?.onPersisted?.({ persistedKeys: [...persistedKeys], written });

      const newSettings = changes.sdkConnection as
        | SDKConnectionSettingsRevisionSnapshot
        | undefined;
      const newWebhooks = changes.sdkWebhooks as
        | SDKWebhookRevisionSnapshot[]
        | undefined;
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
        // A draft can relocate a connection's projects/environment, and the
        // generic move guards read the source scope only — so the DESTINATION
        // is authorized nowhere else. Passing the updates makes the check
        // cover both ends.
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
        // Reported the moment the entity write lands, before webhooks: a
        // webhook failure after this point still leaves the settings change
        // live, and compensation has to know that.
        report();
      }

      if (webhooksChanged) {
        // The model's own hooks gate on the GLOBAL manageEventWebhooks, not the
        // env-scoped manageSDKWebhooks the direct webhook routes enforce — so
        // without this a revision is a way around SDK-webhook permissions.
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
            await context.models.sdkWebhooks.create({
              ...context.models.sdkWebhooks.getDefaultCreateProps(
                entity.sdkConnection.id,
              ),
              // Keep the snapshot's id so the merged revision records the id
              // that actually exists, and a retry sees the webhook as already
              // created instead of making a duplicate. Client-side draft ids
              // are prefixed `temp_`, so let the model mint those.
              ...(wh.id && !wh.id.startsWith("temp_") ? { id: wh.id } : {}),
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
