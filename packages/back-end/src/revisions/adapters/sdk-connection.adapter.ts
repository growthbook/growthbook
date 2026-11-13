import { isEqual, omit } from "lodash";
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
  isAutopublishOnApprovalEnabled,
  normalizeProposedChanges,
  sdkConnectionPublishFootprint,
  sdkConnectionSettingsAfter,
} from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
  sdkConnectionSettingsSnapshotValidator,
  sdkConnectionUpdatableFieldsSchema,
  parseSdkWebhookSnapshot,
  sdkWebhookSnapshotValidator,
  sdkWebhookStableId,
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
import { ConflictError } from "back-end/src/util/errors";
import {
  assertCanChangeSdkWebhooks,
  assertSdkWebhookFields,
  assertSdkWebhookNotManaged,
  assertSdkWebhookPlanLimit,
  sdkConnectionReviewRules,
} from "back-end/src/services/sdkConnectionApprovals";

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

export const CONNECTION_UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(sdkConnectionUpdatableFieldsSchema.shape),
);

// Who may see a webhook's headers, as the live webhook list decides it: someone
// who could update the webhook on every connection it fires for. Looked up
// once per request and connection.
const headerViewers = new WeakMap<
  Context,
  Map<string, Promise<(webhookId: string) => boolean>>
>();
function webhookHeaderViewer(context: Context, connectionId: string) {
  const byConnection = headerViewers.get(context) ?? new Map();
  headerViewers.set(context, byConnection);
  if (!byConnection.has(connectionId)) {
    byConnection.set(
      connectionId,
      (async () => {
        const connection = await findSDKConnectionById(context, connectionId);
        // Both, as reading the webhook itself takes both.
        if (
          !connection ||
          !context.permissions.canUpdateSDKWebhook(connection) ||
          !context.permissions.canManageLegacySDKWebhooks()
        ) {
          return () => false;
        }
        const live =
          await context.models.sdkWebhooks.findLiveSdkWebhooksForRevision([
            connectionId,
          ]);
        const editable =
          await context.models.sdkWebhooks.getEditableWebhookIds(live);
        const liveIds = new Set(live.map((w) => w.id));
        // One only a draft or history holds fires for this connection alone.
        return (id: string) => !liveIds.has(id) || editable.has(id);
      })(),
    );
  }
  return byConnection.get(connectionId)!;
}

// Headers a client left out, having never been shown them, stay as they were.
export function restoreWebhookHeaders(
  base: SDKWebhookRevisionSnapshot[],
  incoming: SDKWebhookRevisionSnapshot[],
): SDKWebhookRevisionSnapshot[] {
  const kept = new Map(base.map((w) => [w.id, w.headers]));
  return incoming.map((w) =>
    w.headers === undefined && kept.get(w.id) !== undefined
      ? { ...w, headers: kept.get(w.id) }
      : w,
  );
}

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  "sdkConnection",
  "sdkWebhooks",
]);

const webhookListValidator = z.array(sdkWebhookSnapshotValidator);

// The stored composite plus the root fields the generic engine reads off a live
// entity; the settings snapshot deliberately excludes `dateUpdated`.
export type SDKConnectionLiveSnapshot = SDKConnectionRevisionSnapshot & {
  id: string;
  projects: string[];
  dateUpdated?: Date;
};

// The settings a revision holds, from a connection flattened to them. Secrets
// and system fields are dropped by the key whitelist.
export function pickSettingsSnapshot(
  flat: Record<string, unknown>,
): SDKConnectionSettingsRevisionSnapshot {
  const settings: Record<string, unknown> = {};
  for (const key of SETTINGS_ALLOWED_KEYS) {
    const value = flat[key];
    if (value === null || value === undefined) continue;
    settings[key] = value;
  }
  return settings as unknown as SDKConnectionSettingsRevisionSnapshot;
}

function toConnectionSettingsSnapshot(
  entity: Record<string, unknown>,
): SDKConnectionSettingsRevisionSnapshot {
  const proxy = entity.proxy as ProxyConnection | undefined;
  return pickSettingsSnapshot({
    ...entity,
    proxyEnabled: proxy ? proxy.enabled : entity.proxyEnabled,
    proxyHost: proxy ? proxy.host : entity.proxyHost,
  });
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
): SDKConnectionRevisionSnapshot {
  const whs = (entity._webhooks as WebhookInterface[] | undefined) ?? [];
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
  const rules = sdkConnectionReviewRules(
    context,
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
            await context.models.sdkWebhooks.findLiveSdkWebhooksForRevision([
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
      if ("sdkConnection" in raw) {
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

    archivedState(snapshot, proposedChanges) {
      let proposed: boolean | undefined;
      for (const op of normalizeProposedChanges(proposedChanges)) {
        if (op.path !== "/sdkConnection") continue;
        if (op.op !== "replace" && op.op !== "add") continue;
        proposed = (op.value as SDKConnectionSettingsRevisionSnapshot | null)
          ?.archived;
      }
      return { current: snapshot.sdkConnection.archived, proposed };
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
      proposedChanges?: unknown,
    ): boolean {
      if (!canBypassAcrossProjects(context, snapshot)) return false;
      if (proposedChanges === undefined) return true;
      // A draft that moves the connection needs bypass in the Projects it
      // moves into, as the direct save paths require.
      const after = sdkConnectionSettingsAfter(snapshot, proposedChanges);
      return canBypassAcrossProjects(context, {
        ...snapshot,
        sdkConnection: {
          ...snapshot.sdkConnection,
          projects: after.projects ?? [],
        },
      });
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
      return isAutopublishOnApprovalEnabled(
        context.org.settings,
        "sdk-connection",
        [],
        snapshot,
      );
    },

    async scrubForViewer(context, target, fragment) {
      const rows = fragment.sdkWebhooks;
      if (!Array.isArray(rows) || !rows.some((w) => w?.headers !== undefined)) {
        return fragment;
      }
      const canSee = await webhookHeaderViewer(context, target.id);
      return {
        ...fragment,
        sdkWebhooks: rows.map((w) => (canSee(w.id) ? w : omit(w, "headers"))),
      };
    },

    restoreScrubbed(base, incoming) {
      if (!Array.isArray(incoming.sdkWebhooks)) return incoming;
      return {
        ...incoming,
        sdkWebhooks: restoreWebhookHeaders(
          base.sdkWebhooks ?? [],
          incoming.sdkWebhooks,
        ),
      };
    },

    // For the generic publish paths that skip the PUT controller. Runs before
    // the merge is claimed, so a rejection leaves the draft open.
    async assertPublishable(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      desiredState: Record<string, unknown>,
      revision: Revision,
    ): Promise<void> {
      // A draft cut before the connection moved was judged against the rules
      // of where it used to be, so it takes on the new scope first. A claimed
      // merge is past rebasing and still has to be recoverable.
      const drafted = (
        revision.target.snapshot as SDKConnectionRevisionSnapshot
      ).sdkConnection;
      const live = entity.sdkConnection;
      if (
        revision.status !== "merged" &&
        isSdkConnectionApprovalRequired(context) &&
        (drafted.environment !== live.environment ||
          !isEqual([...drafted.projects].sort(), [...live.projects].sort()))
      ) {
        throw new ConflictError(
          "This SDK connection's environment or Projects changed after this draft was created. Rebase the draft with live, then publish it.",
        );
      }

      if (desiredState.sdkConnection !== undefined) {
        const settings = sdkConnectionSettingsSnapshotValidator.parse(
          desiredState.sdkConnection,
        );
        const changes = filterUpdatableChanges(
          settings,
          entity.sdkConnection,
          CONNECTION_UPDATABLE_FIELDS,
        );
        const { premiumSettingsWithoutPlan, validateSdkConnectionChanges } =
          await loadValidations();
        await validateSdkConnectionChanges(
          context,
          changes,
          entity.sdkConnection,
        );
        // `changes` holds only what differs, so true means turned on.
        const [blocked] = premiumSettingsWithoutPlan(context, changes);
        if (blocked) {
          throw new Error(
            `Enabling ${blocked[1]} requires the "${blocked[0]}" premium feature`,
          );
        }
      }

      if (desiredState.sdkWebhooks !== undefined) {
        const webhooks = webhookListValidator.parse(desiredState.sdkWebhooks);
        const proposedIds = new Set(webhooks.map((w) => w.id));
        const baselineIds = new Set(entity.sdkWebhooks.map((w) => w.id));
        await assertSdkWebhookPlanLimit(
          context,
          webhooks.filter((w) => !baselineIds.has(w.id)).length,
          entity.sdkWebhooks.filter((w) => !proposedIds.has(w.id)).length,
        );
        // Only the API can attach a webhook to several connections, and one
        // connection's draft doesn't speak for the others.
        const touchedIds = entity.sdkWebhooks
          .filter((old) => {
            const next = webhooks.find((w) => w.id === old.id);
            return !next || !isEqual(next, old);
          })
          .map((w) => w.id);
        // A restored webhook whose row now fires only for other connections
        // would be skipped by the landing as already there.
        for (const w of webhooks.filter((w) => !baselineIds.has(w.id))) {
          const row = await context.models.sdkWebhooks.getById(w.id);
          if (row?.sdks && !row.sdks.includes(entity.sdkConnection.id)) {
            throw new Error(
              `The webhook "${w.name}" now belongs to another SDK connection, so this one can't bring it back. Remove it from the draft, or move it back through the API.`,
            );
          }
        }
        // Refused here, before the merge is claimed, not partway through landing.
        webhooks
          .filter((w) => !baselineIds.has(w.id) || touchedIds.includes(w.id))
          .forEach((w) => {
            const old = entity.sdkWebhooks.find((o) => o.id === w.id) ?? null;
            assertSdkWebhookNotManaged(old, w.payloadFormat);
            assertSdkWebhookFields({
              endpoint: w.endpoint !== old?.endpoint ? w.endpoint : undefined,
              headers: w.headers !== old?.headers ? w.headers : undefined,
            });
          });
        if (touchedIds.length) {
          const rows =
            await context.models.sdkWebhooks.findLiveSdkWebhooksForRevision([
              entity.sdkConnection.id,
            ]);
          rows
            .filter((row) => touchedIds.includes(row.id))
            .forEach((row) => assertSdkWebhookNotManaged(row));
          const shared = rows.some(
            (row) =>
              touchedIds.includes(row.id) &&
              row.sdks.some((id) => id !== entity.sdkConnection.id),
          );
          if (shared) {
            throw new Error(
              "A webhook used by other SDK connections can't be changed from this one. Change it through the API.",
            );
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
        parseSdkWebhookSnapshot({
          ...wh,
          id: sdkWebhookStableId(entity.sdkConnection.id, wh.id),
          httpMethod: wh.httpMethod ?? "POST",
        }),
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
      } else if (webhooksChanged && options?.guarded) {
        // Webhook rows carry no version of their own, so a webhook-only landing
        // claims the connection's stamp; direct webhook edits advance it too.
        liveConnection = await editSDKConnection(
          context,
          connection,
          {},
          {
            casOnDateUpdated: baselineStamp ?? null,
          },
        );
      }

      if (webhooksChanged) {
        // The model's hooks only check the global manageEventWebhooks, not the
        // env-scoped SDK-webhook permissions.
        assertCanChangeSdkWebhooks(
          context,
          {
            projects: entity.sdkConnection.projects,
            environment: entity.sdkConnection.environment,
          },
          entity.sdkWebhooks,
          newWebhooks,
        );

        const oldById = new Map(entity.sdkWebhooks.map((w) => [w.id, w]));
        const newById = new Map(newWebhooks.map((w) => [w.id, w]));

        // Reported after every write, so a failure part-way leaves compensation
        // the webhooks that are actually live.
        let current = [...entity.sdkWebhooks];
        const recordWebhooks = () => {
          if (!persistedKeys.includes("sdkWebhooks")) {
            persistedKeys.push("sdkWebhooks");
          }
          written = toLiveSnapshot(liveConnection, current);
          report();
        };

        for (const wh of newWebhooks) {
          if (oldById.has(wh.id)) continue;
          // A retried landing skips webhooks an earlier attempt created.
          if (!(await context.models.sdkWebhooks.getById(wh.id))) {
            await context.models.sdkWebhooks.create({
              ...context.models.sdkWebhooks.getDefaultCreateProps(
                entity.sdkConnection.id,
              ),
              id: wh.id,
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
          current = [...current, wh];
          recordWebhooks();
        }

        for (const newWh of newWebhooks) {
          const oldWh = oldById.get(newWh.id);
          if (!oldWh || isEqual(newWh, oldWh)) continue;
          const liveWebhook = await context.models.sdkWebhooks.getById(
            newWh.id,
          );
          if (liveWebhook) {
            await context.models.sdkWebhooks.applyEdit(liveWebhook, {
              name: newWh.name,
              endpoint: newWh.endpoint,
              httpMethod: newWh.httpMethod,
              headers: newWh.headers,
              payloadFormat: newWh.payloadFormat,
              payloadKey: newWh.payloadKey,
              timeoutSeconds: newWh.timeoutSeconds ?? null,
            });
          }
          current = current.map((w) => (w.id === newWh.id ? newWh : w));
          recordWebhooks();
        }

        for (const oldWh of entity.sdkWebhooks) {
          if (newById.has(oldWh.id)) continue;
          const liveWebhook = await context.models.sdkWebhooks.getById(
            oldWh.id,
          );
          if (liveWebhook) {
            await context.models.sdkWebhooks.delete(liveWebhook);
          }
          current = current.filter((w) => w.id !== oldWh.id);
          recordWebhooks();
        }

        current = newWebhooks;
        recordWebhooks();
      }

      return { persistedKeys, written };
    },
  };
