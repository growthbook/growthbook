import { isEqual, omit } from "lodash";
import { z } from "zod";
import {
  EditSDKConnectionParams,
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
  sdkConnectionDraftSettingsAfterSave,
  sdkConnectionPublishFootprint,
  sdkConnectionSettingsAfter,
  sdkConnectionSettingsEqual,
  withAbsentSdkSettings,
  applyTopLevelPatchOps,
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
  pickSdkConnectionSettings,
  sdkConnectionSettingsOf,
  withoutProxySettings,
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
import {
  BadRequestError,
  ConflictError,
  TerminalPublishError,
  getErrorMessage,
} from "back-end/src/util/errors";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { buildArmAcknowledgments } from "back-end/src/services/armGuards";
import {
  assertWebhookSecrets,
  captureWebhookSecretsAcknowledgment,
  missingWebhookSecrets,
  webhookSecretGates,
} from "back-end/src/services/webhookSecretGuard";
import {
  captureEventBuffer,
  emitOrDeferBulkPublishEvent,
  entityKey,
} from "back-end/src/events/bulkPublishCorrelation";
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
// Likewise for the hook runner.
function loadHooks() {
  return import("back-end/src/enterprise/sandbox/sandbox-eval");
}

// Run once the landing stands. A payload rebuild it queued for the connection
// sends every webhook itself, after the new payload is cached.
// `refresh` is the buffer the landing wrote into: a release has detached it
// from the context by the time this runs.
function sendLandedWebhookEdits(
  context: Context,
  refresh: Context["sdkPayloadRefreshBuffer"],
  connection: SDKConnectionInterface,
  webhooks: WebhookInterface[],
) {
  if (refresh?.sdkConnections?.some((c) => c.key === connection.key)) return;
  webhooks.forEach((w) => context.models.sdkWebhooks.send(w));
}

export const CONNECTION_UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(sdkConnectionUpdatableFieldsSchema.shape),
);

// Settings a stored connection may lack. The proxy ones map onto the nested
// `proxy`, which every connection has.
const UNSETTABLE_SETTINGS = Object.entries(
  sdkConnectionUpdatableFieldsSchema.shape,
)
  .filter(
    ([key, schema]) =>
      schema.isOptional() && key !== "proxyEnabled" && key !== "proxyHost",
  )
  .map(
    ([key]) =>
      key as keyof SDKConnectionSettingsRevisionSnapshot &
        keyof SDKConnectionInterface,
  );

// Who may see a webhook's headers, as the live webhook list decides it: someone
// who could update the webhook on every connection it fires for now, whether or
// not this connection is still one of them. Without a stored row, managing this
// connection's webhooks is enough. Each webhook is looked up once per request
// and connection.
type HeaderViewer = (ids: string[]) => Promise<(id: string) => boolean>;
const headerViewers = new WeakMap<Context, Map<string, HeaderViewer>>();
function webhookHeaderViewer(
  context: Context,
  connectionId: string,
): HeaderViewer {
  const byConnection =
    headerViewers.get(context) ?? new Map<string, HeaderViewer>();
  headerViewers.set(context, byConnection);
  const cached = byConnection.get(connectionId);
  if (cached) return cached;

  const canManageHere = findSDKConnectionById(context, connectionId).then(
    (connection) =>
      !!connection && context.permissions.canUpdateSDKWebhook(connection),
  );
  const visible = new Map<string, Promise<boolean>>();
  const viewer: HeaderViewer = async (ids) => {
    // A draft's temp id names the row its landing created.
    const rowIds = ids.map((id) => sdkWebhookStableId(connectionId, id));
    const unseen = [...new Set(rowIds.filter((id) => !visible.has(id)))];
    if (unseen.length) {
      const lookup = (async () => {
        if (!(await canManageHere)) return new Set<string>();
        const rows =
          await context.models.sdkWebhooks.findSdkWebhooksByIdsForRevision(
            unseen,
          );
        const editable = rows.length
          ? await context.models.sdkWebhooks.getEditableWebhookIds(rows)
          : new Set<string>();
        const stored = new Set(rows.map((w) => w.id));
        return new Set(
          unseen.filter((id) => (stored.has(id) ? editable.has(id) : true)),
        );
      })();
      unseen.forEach((id) =>
        visible.set(
          id,
          lookup.then((allowed) => allowed.has(id)),
        ),
      );
    }
    const results = await Promise.all(rowIds.map((id) => visible.get(id)));
    const allowed = new Set(ids.filter((_, i) => results[i] === true));
    return (id) => allowed.has(id);
  };
  byConnection.set(connectionId, viewer);
  return viewer;
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

// A landed webhook stores no headers as "".
const withHeaders = (wh: SDKWebhookRevisionSnapshot) => ({
  ...wh,
  headers: wh.headers ?? "",
});

// What reverting to the state a published revision left changes on the live
// connection: live's settings with that state's on top, where a setting the
// state predates is turned off, and the webhooks as they were. Archiving is
// its own action, so a revert leaves it alone.
export function sdkConnectionRevertChanges(
  live: SDKConnectionRevisionSnapshot,
  then: SDKConnectionRevisionSnapshot,
): Partial<SDKConnectionRevisionSnapshot> {
  const sdkConnection = pickSdkConnectionSettings(
    sdkConnectionDraftSettingsAfterSave(
      live.sdkConnection,
      live.sdkConnection,
      withAbsentSdkSettings(omit(then.sdkConnection, "archived")),
    ),
  );
  const liveById = new Map(live.sdkWebhooks.map((wh) => [wh.id, wh]));
  const sdkWebhooks = then.sdkWebhooks.map((wh) => {
    const was = parseSdkWebhookSnapshot(wh);
    const now = liveById.get(was.id);
    return now && isEqual(withHeaders(was), withHeaders(now)) ? now : was;
  });
  return {
    ...(!sdkConnectionSettingsEqual(sdkConnection, live.sdkConnection) && {
      sdkConnection,
    }),
    ...(!isEqual(sdkWebhooks, live.sdkWebhooks) && { sdkWebhooks }),
  };
}

// Whether a change is exactly that revert. The change may come from a
// caller's request, so naming a revision is not enough to count as one.
export function isSdkConnectionRevert(
  live: SDKConnectionRevisionSnapshot,
  then: SDKConnectionRevisionSnapshot,
  changes: Partial<SDKConnectionRevisionSnapshot>,
): boolean {
  const revert = sdkConnectionRevertChanges(live, then);
  return (
    Object.keys(revert).length > 0 &&
    sdkConnectionSettingsEqual(
      changes.sdkConnection ?? live.sdkConnection,
      revert.sdkConnection ?? live.sdkConnection,
    ) &&
    isEqual(
      (changes.sdkWebhooks ?? live.sdkWebhooks).map(withHeaders),
      (revert.sdkWebhooks ?? live.sdkWebhooks).map(withHeaders),
    )
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

// Webhook rows a landing in this request changed or removed, as they were. A
// snapshot leaves out the signing key and delivery state, so a rollback puts
// these back instead of rebuilding the row from one.
const replacedWebhookRows = new WeakMap<
  Context,
  Map<string, WebhookInterface>
>();
function replacedRows(context: Context): Map<string, WebhookInterface> {
  const rows = replacedWebhookRows.get(context) ?? new Map();
  replacedWebhookRows.set(context, rows);
  return rows;
}
const asStored = (row: WebhookInterface) =>
  omit(row, ["id", "organization", "dateCreated", "dateUpdated"]);

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
    sdkConnection: sdkConnectionSettingsOf(entity),
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
    sdkConnection: sdkConnectionSettingsOf({ ...connection }),
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
          sdkConnection: sdkConnectionSettingsOf(
            (raw.sdkConnection ?? {}) as Record<string, unknown>,
          ),
          sdkWebhooks: (raw.sdkWebhooks ?? []) as SDKWebhookRevisionSnapshot[],
        };
      }

      return toSnapshot(raw);
    },

    behindLiveView: (snapshot) =>
      IS_CLOUD ? snapshot : withoutProxySettings(snapshot),

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

    // The destination's approval rules apply to a move, so its reviewers must too.
    reviewScopes(
      snapshot: SDKConnectionRevisionSnapshot,
      proposedChanges: unknown,
    ): SDKConnectionRevisionSnapshot[] {
      const before = snapshot.sdkConnection.projects ?? [];
      const after =
        sdkConnectionSettingsAfter(snapshot, proposedChanges).projects ?? [];
      if (isEqual([...before].sort(), [...after].sort())) return [snapshot];
      return [
        snapshot,
        {
          ...snapshot,
          sdkConnection: { ...snapshot.sdkConnection, projects: after },
        },
      ];
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

    async scrubForViewer(context, target, fragment, hideAll) {
      const rows = fragment.sdkWebhooks;
      if (!Array.isArray(rows) || !rows.some((w) => w?.headers !== undefined)) {
        return fragment;
      }
      const canSee = hideAll
        ? () => false
        : await webhookHeaderViewer(
            context,
            target.id,
          )(rows.filter((w) => w?.headers !== undefined).map((w) => w.id));
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

    async validateRevisionWrite(context, write) {
      const { runValidateSdkConnectionRevisionHooks } = await loadHooks();
      await runValidateSdkConnectionRevisionHooks({ context, ...write });
    },

    async collectPublishGates(context, entity, revision, desiredState) {
      return webhookSecretGates(
        await missingWebhookSecrets(
          context,
          entity.sdkWebhooks,
          webhookListValidator.parse(
            desiredState.sdkWebhooks ?? entity.sdkWebhooks,
          ),
        ),
      );
    },

    async captureArmAcknowledgment(context, entity, proposedChanges) {
      return buildArmAcknowledgments({
        "webhook-secrets": await captureWebhookSecretsAcknowledgment(
          context,
          entity.sdkWebhooks,
          applyTopLevelPatchOps(entity, proposedChanges).sdkWebhooks,
        ),
      });
    },

    // For the generic publish paths that skip the PUT controller. Runs before
    // the merge is claimed, so a rejection leaves the draft open.
    async assertPublishable(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      desiredState: Record<string, unknown>,
      revision: Revision,
      options?: { hooksAlreadyRan?: boolean; deferred?: boolean },
    ): Promise<void> {
      const proposed = { ...entity };
      try {
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
          proposed.sdkConnection = settings;
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
            throw new BadRequestError(
              `Enabling ${blocked[1]} requires the "${blocked[0]}" premium feature`,
            );
          }
        }

        if (desiredState.sdkWebhooks !== undefined) {
          const webhooks = webhookListValidator.parse(desiredState.sdkWebhooks);
          proposed.sdkWebhooks = webhooks;
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
              throw new BadRequestError(
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
              assertSdkWebhookFields(w, old);
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
              throw new BadRequestError(
                "A webhook used by other SDK connections can't be changed from this one. Change it through the API.",
              );
            }
          }
        }
      } catch (e) {
        // A refusal repeats on every retry, so a scheduled publish stops.
        const refused = ((e as { status?: number }).status ?? 500) < 500;
        throw options?.deferred && refused
          ? new TerminalPublishError(getErrorMessage(e))
          : e;
      }

      // A caller that collected gates has already put the warnings to its
      // caller, hooks' and this one alike.
      if (!options?.hooksAlreadyRan) {
        await assertWebhookSecrets(
          context,
          entity.sdkWebhooks,
          proposed.sdkWebhooks,
          options?.deferred ? revision : undefined,
        );
        const {
          runValidateSdkConnectionHooks,
          runValidateSdkConnectionRevisionHooks,
        } = await loadHooks();
        await runValidateSdkConnectionHooks({
          context,
          original: entity,
          sdkConnection: proposed,
        });
        // A direct write checks itself against a stand-in with no id.
        if (revision.id) {
          await runValidateSdkConnectionRevisionHooks({
            context,
            live: entity,
            revision,
            publishing: true,
            proposed,
            before: entity,
          });
        }
      }
    },

    async applyChanges(
      context: Context,
      entity: SDKConnectionRevisionSnapshot,
      changes: Record<string, unknown>,
      options?: {
        isRevert?: boolean;
        isCompensation?: boolean;
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
        }),
      );
      const settingsChanges = newSettings
        ? filterUpdatableChanges(
            newSettings,
            entity.sdkConnection,
            CONNECTION_UPDATABLE_FIELDS,
          )
        : {};
      // A restore writes back a whole pre-image, so a setting it lacks was
      // unset before the failed write. A publish lands only what it changed.
      const clearedSettings =
        newSettings && options?.isCompensation
          ? UNSETTABLE_SETTINGS.filter(
              (key) =>
                newSettings[key] === undefined &&
                entity.sdkConnection[key] !== undefined,
            )
          : [];
      const settingsChanged =
        Object.keys(settingsChanges).length > 0 || clearedSettings.length > 0;
      const webhooksChanged =
        newWebhooks !== undefined && !isEqual(newWebhooks, entity.sdkWebhooks);

      if (!settingsChanged && !webhooksChanged) {
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

      // Every check runs before the first write, so a refused publish leaves
      // nothing live to compensate for.
      // The generic move guards read the source scope only, so authorize the
      // destination here.
      if (
        settingsChanged &&
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
      if (webhooksChanged) {
        // The model's hooks can't see the connection, so its scope is checked
        // here, before the first write.
        assertCanChangeSdkWebhooks(
          context,
          {
            projects: entity.sdkConnection.projects,
            environment: entity.sdkConnection.environment,
          },
          entity.sdkWebhooks,
          newWebhooks,
        );
      }

      let liveConnection: SDKConnectionInterface = connection;
      if (settingsChanged) {
        const editOptions = {
          ...(options?.guarded && { casOnDateUpdated: baselineStamp ?? null }),
          ...(clearedSettings.length > 0 && { unset: clearedSettings }),
        };
        liveConnection = await editSDKConnection(
          context,
          connection,
          settingsChanges as EditSDKConnectionParams,
          Object.keys(editOptions).length > 0 ? editOptions : undefined,
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
        const oldById = new Map(entity.sdkWebhooks.map((w) => [w.id, w]));
        const newById = new Map(newWebhooks.map((w) => [w.id, w]));
        const replaced = replacedRows(context);

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
          const removed = options?.isCompensation && replaced.get(wh.id);
          // A retried landing skips webhooks an earlier attempt created.
          const row =
            (await context.models.sdkWebhooks.getById(wh.id)) ??
            (await context.models.sdkWebhooks.create({
              ...(removed
                ? asStored(removed)
                : context.models.sdkWebhooks.getDefaultCreateProps(
                    entity.sdkConnection.id,
                  )),
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
            }));
          // As stored, which is what compensation compares live against.
          current = [...current, toWebhookSnapshot(row)];
          recordWebhooks();
        }

        const edited: WebhookInterface[] = [];
        for (const newWh of newWebhooks) {
          const oldWh = oldById.get(newWh.id);
          if (!oldWh || isEqual(newWh, oldWh)) continue;
          const liveWebhook = await context.models.sdkWebhooks.getById(
            newWh.id,
          );
          if (liveWebhook) {
            const original = options?.isCompensation && replaced.get(newWh.id);
            if (!replaced.has(newWh.id)) replaced.set(newWh.id, liveWebhook);
            const saved = original
              ? await context.models.sdkWebhooks.update(
                  liveWebhook,
                  asStored(original),
                )
              : await context.models.sdkWebhooks.saveEdit(liveWebhook, {
                  name: newWh.name,
                  endpoint: newWh.endpoint,
                  httpMethod: newWh.httpMethod,
                  headers: newWh.headers,
                  payloadFormat: newWh.payloadFormat,
                  payloadKey: newWh.payloadKey,
                  timeoutSeconds: newWh.timeoutSeconds ?? null,
                });
            edited.push(saved);
            current = current.map((w) =>
              w.id === newWh.id ? toWebhookSnapshot(saved) : w,
            );
          }
          recordWebhooks();
        }

        for (const oldWh of entity.sdkWebhooks) {
          if (newById.has(oldWh.id)) continue;
          const liveWebhook = await context.models.sdkWebhooks.getById(
            oldWh.id,
          );
          if (liveWebhook) {
            if (!replaced.has(oldWh.id)) replaced.set(oldWh.id, liveWebhook);
            await context.models.sdkWebhooks.delete(liveWebhook);
          }
          current = current.filter((w) => w.id !== oldWh.id);
          recordWebhooks();
        }

        // In the revision's order, each as stored.
        const stored = new Map(current.map((w) => [w.id, w]));
        current = newWebhooks.map((w) => stored.get(w.id) ?? w);
        recordWebhooks();

        if (edited.length) {
          const refresh = context.sdkPayloadRefreshBuffer;
          await emitOrDeferBulkPublishEvent(
            async () =>
              sendLandedWebhookEdits(context, refresh, liveConnection, edited),
            entityKey("sdk-connection", entity.sdkConnection.id),
            captureEventBuffer(context),
          );
        }
      }

      return { persistedKeys, written };
    },
  };
