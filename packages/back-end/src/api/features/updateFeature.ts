import {
  getApplicableEnvIds,
  getRulesForEnvironment,
  normalizeTargetingInUpdates,
  stemRuleId,
  validateFeatureValue,
} from "shared/util";
import { isEqual, omit } from "lodash";
import { updateFeatureValidator } from "shared/validators";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
  createAndPublishRevision,
} from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { BadRequestError } from "back-end/src/util/errors";
import {
  addIdsToFlatRules,
  addIdsToRules,
  fromApiEnvSettingsRulesToFeatureEnvSettingsRules,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  inheritStoredRolloutSeeds,
  updateInterfaceEnvSettingsFromApiEnvSettings,
} from "back-end/src/services/features";
import {
  getArchiveFootprint,
  getEnabledEnvironments,
} from "back-end/src/util/features";
import { isArchiveTransition } from "back-end/src/revisions/archiveTransition";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getRevision,
  normalizeRulesInputToV2,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getEnvironments,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  dispatchFeatureRevisionEvent,
  getPublishedRevisionForEvents,
} from "back-end/src/services/featureRevisionEvents";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import { validateEnvKeys } from "./postFeature";
import { validateCustomFields } from "./validations";
import {
  canBypassReviewChecks,
  canUseRestApiBypassSetting,
} from "./reviewBypass";
import {
  assertValidHoldout,
  assertValidProjectId,
  assertValidProjectIds,
  assertValidRuleProjectIds,
  assertValidBaseConfig,
  assertConfigSchemaCompat,
  extractRevisionMetadata,
  validateEnvRulesScheduleRules,
} from "./v2Shared";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req) => {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error(`Feature id '${req.params.id}' not found.`);
    }

    const {
      owner: ownerInput,
      archived,
      description,
      project,
      targetingAllProjects,
      targetingProjects,
      tags,
      customFields,
    } = req.body;
    const owner = await resolveOwnerToUserId(ownerInput, req.context);

    const effectiveProject =
      typeof project === "undefined" ? feature.project : project;

    const orgEnvs = getEnvironmentIdsFromOrg(req.context.org);

    // Authoring gate. Landing authority is checked below, per part of the body
    // that reaches the payload — a publisher alone may land someone else's
    // draft, not write new content through this endpoint.
    if (!req.context.permissions.canEditFeatureDrafts(feature)) {
      req.context.permissions.throwPermissionError();
    }
    if (
      req.context.org.settings?.requireProjectForFeatures &&
      feature.project &&
      (effectiveProject == null || effectiveProject === "")
    ) {
      throw new Error("Must specify a project");
    }

    if (project != null) {
      if (
        !req.context.permissions.canEditFeatureDrafts({ project }) ||
        !req.context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, orgEnvs)),
        ) ||
        !req.context.permissions.canPublishFeature(
          { project },
          Array.from(getEnabledEnvironments(feature, orgEnvs)),
        )
      ) {
        req.context.permissions.throwPermissionError();
      }
    }

    await assertValidProjectId(project, req.context);
    await assertValidProjectIds(targetingProjects, req.context);

    // check if the custom fields are valid
    const projectChanged = project !== undefined && project !== feature.project;
    const customFieldsChanged = shouldValidateCustomFieldsOnUpdate({
      existingCustomFieldValues: feature.customFields,
      updatedCustomFieldValues: customFields,
    });

    let effectiveCustomFields = customFields;
    if (projectChanged || customFieldsChanged) {
      const { customFieldValues, prunedKeys } = await validateCustomFields(
        customFields ?? feature.customFields,
        req.context,
        effectiveProject,
        feature.customFields,
      );
      // Write the pruned map back so the dead keys stop blocking future updates.
      if (prunedKeys.length) effectiveCustomFields = customFieldValues;
    }

    // ensure environment keys are valid
    if (req.body.environments != null) {
      validateEnvKeys(orgEnvs, Object.keys(req.body.environments ?? {}));
    }

    validateEnvRulesScheduleRules(req.body.environments, req.context);

    // ensure default value matches value type
    let defaultValue;
    if (req.body.defaultValue != null) {
      defaultValue = validateFeatureValue(feature, req.body.defaultValue);
    }

    const environmentSettings =
      req.body.environments != null
        ? updateInterfaceEnvSettingsFromApiEnvSettings(
            feature,
            req.body.environments,
          )
        : null;

    const prerequisites =
      req.body.prerequisites != null
        ? req.body.prerequisites?.map((p) => ({
            id: p,
            condition: `{"value": true}`,
          }))
        : null;

    if (req.body.holdout !== undefined || req.body.project !== undefined) {
      await assertValidHoldout(
        req.body.holdout !== undefined ? req.body.holdout : feature.holdout,
        req.context,
        req.body.project ?? feature.project,
      );
    }

    const jsonSchema =
      feature.valueType !== "boolean" && req.body.jsonSchema != null
        ? parseApiJsonSchema(
            req.organization,
            req.body.jsonSchema,
            feature.valueType,
          )
        : null;

    // The backing config is fixed at creation — reject any attempt to change it
    // (a no-op resend of the same value is allowed). Matches the UI, which only
    // sets baseConfig when the feature is created.
    if (
      req.body.baseConfig !== undefined &&
      (req.body.baseConfig ?? null) !== (feature.baseConfig ?? null)
    ) {
      throw new BadRequestError(
        `The backing Config cannot be changed after creation (existing: ${
          feature.baseConfig ? `"${feature.baseConfig}"` : "none"
        }, provided: ${
          req.body.baseConfig ? `"${req.body.baseConfig}"` : "none"
        }).`,
      );
    }

    // Config mode: validate the effective baseConfig (live + JSON) and that it
    // doesn't coexist with an enabled JSON schema.
    const effectiveBaseConfig =
      req.body.baseConfig !== undefined
        ? (req.body.baseConfig ?? null)
        : (feature.baseConfig ?? null);
    await assertValidBaseConfig(
      req.context,
      effectiveBaseConfig,
      feature.valueType,
      effectiveProject,
    );
    assertConfigSchemaCompat({
      jsonSchemaEnabled: (jsonSchema ?? feature.jsonSchema)?.enabled,
      baseConfig: effectiveBaseConfig,
    });

    let updates: Partial<FeatureInterface> = {
      ...(ownerInput !== undefined ? { owner: owner ?? "" } : {}),
      ...(archived != null ? { archived } : {}),
      ...(description != null ? { description } : {}),
      ...(project != null ? { project } : {}),
      ...(targetingAllProjects != null ? { targetingAllProjects } : {}),
      ...(targetingProjects != null ? { targetingProjects } : {}),
      ...(tags != null ? { tags } : {}),
      ...(defaultValue != null ? { defaultValue } : {}),
      ...(req.body.baseConfig !== undefined
        ? { baseConfig: req.body.baseConfig ?? null }
        : {}),
      ...(environmentSettings != null ? { environmentSettings } : {}),
      ...(prerequisites != null ? { prerequisites } : {}),
      ...(jsonSchema != null ? { jsonSchema } : {}),
      ...(effectiveCustomFields != null
        ? { customFields: effectiveCustomFields }
        : {}),
    };
    normalizeTargetingInUpdates(updates, feature);

    // Archiving takes the flag out of service, so it is delete-class wherever it
    // lands — the same rule the archive endpoints and the revision publish path
    // apply. Unarchiving returns it to service and stays an ordinary publish.
    const archiving = isArchiveTransition({
      proposed: updates.archived ?? undefined,
      current: feature.archived,
    });
    if (
      archiving &&
      !req.context.permissions.canDeleteFeature(
        { project: effectiveProject },
        getArchiveFootprint(feature, req.context.org),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }

    if (
      updates.environmentSettings ||
      updates.defaultValue != null ||
      updates.project != null ||
      // Archiving is delete-class INSTEAD of publish-class, not as well as — the
      // gate above is the whole check. Demanding both here meant this route asked a
      // delete-only caller for publish while the archive endpoints did not. A re-send
      // of the state the flag already has isn't a transition either way, so it must
      // not fall through to the publish arm and 403 a no-op.
      (updates.archived != null &&
        !archiving &&
        (updates.archived ?? false) !== (feature.archived ?? false))
    ) {
      if (
        !req.context.permissions.canPublishFeature(
          { project: effectiveProject },
          Array.from(
            getEnabledEnvironments(
              {
                ...feature,
                ...updates,
              },
              orgEnvs,
            ),
          ),
        )
      ) {
        req.context.permissions.throwPermissionError();
      }
      addIdsToRules(updates.environmentSettings, feature.id);
    }

    // Recompute next-scheduled-update whenever top-level `rules` OR
    // `environmentSettings` change (the latter for REST callers still posting
    // v1-shape env rules, which adapters normalize upstream).
    if (updates.rules !== undefined || updates.environmentSettings) {
      updates.nextScheduledUpdate = getNextScheduledUpdate(
        updates.rules ?? feature.rules,
      );
    }

    // JWT-backed REST calls should behave like dashboard actions: the org-level
    // REST bypass setting only applies to API keys/PATs.
    const canBypass = canBypassReviewChecks(req, feature);

    // Tags go into the revision metadata; capture them before stripping from updates.
    const newTagsForDiff = updates.tags;

    // Build a single combined revision for all change types.

    // 1. environmentsEnabled (kill switches)
    const changedEnvEnabled: Record<string, boolean> = {};
    if (updates.environmentSettings) {
      for (const [env, settings] of Object.entries(
        updates.environmentSettings,
      )) {
        if (
          typeof settings.enabled === "boolean" &&
          settings.enabled !== feature.environmentSettings?.[env]?.enabled
        ) {
          changedEnvEnabled[env] = settings.enabled;
          // Exclude enabled from the direct-write path to avoid applying it twice.
          updates.environmentSettings[env] = {
            ...updates.environmentSettings[env],
            enabled: feature.environmentSettings?.[env]?.enabled ?? false,
          };
        }
      }
    }

    // 2. rules / defaultValue
    // v2: rules live on feature.rules (flat). Normalize inbound per-env rules
    // through `normalizeRulesInputToV2` so content-identical rules across envs
    // collapse to a single v2 rule with `environments: [...envs]` (or
    // `allEnvironments: true` when applicable) — matches the read-path JIT
    // and preserves v1 round-trip semantics for clients that send the same
    // rule id across envs. Then union with existing rules for envs the caller
    // didn't touch so we don't lose them on partial updates.
    const incomingEnvs = req.body.environments ?? {};
    const inboundRulesByEnv: Record<string, FeatureRule[]> = {};
    for (const [env, envSettings] of Object.entries(incomingEnvs)) {
      if (!envSettings.rules) continue;
      const converted = fromApiEnvSettingsRulesToFeatureEnvSettingsRules(
        req.context,
        feature,
        envSettings.rules,
        feature.rules ?? [],
      );
      // Inherit stored seed/hashVersion first so the backfill can't re-bucket a legacy rollout.
      inheritStoredRolloutSeeds(converted, feature.rules ?? []);
      // Stamp ids before flattening — `flattenV1ToV2Rules` groups by id and
      // drops id-less rules. Without this, v1 clients that omit ids would
      // lose those rules on PUT.
      addIdsToFlatRules(converted, feature.id);
      inboundRulesByEnv[env] = converted;
    }
    const inboundFlatRules: FeatureRule[] =
      Object.keys(inboundRulesByEnv).length > 0
        ? normalizeRulesInputToV2(inboundRulesByEnv, {
            orgEnvs: getEnvironments(req.context.org),
            featureProject: effectiveProject,
          })
        : [];
    await assertValidRuleProjectIds(inboundFlatRules, req.context);
    // Envs whose rule lists the caller is replacing. Envs present in the
    // payload with only `enabled` (no `rules` key) keep their current rules.
    const rulesTouchedEnvs = new Set(Object.keys(inboundRulesByEnv));
    // Union of primary + targeting envs (not the bare primary), so a wildcard
    // rule serving a targeting-only env isn't silently scrubbed on a PUT that
    // touches a different env.
    const applicableEnvIds = getApplicableEnvIds(
      getEnvironments(req.context.org),
      {
        project: effectiveProject,
        targetingProjects: targetingProjects ?? feature.targetingProjects,
        targetingAllProjects:
          targetingAllProjects ?? feature.targetingAllProjects,
      },
    );

    // Carry through rules for envs the caller didn't touch. A single v2 rule
    // can span several envs (content-identical rules collapse on migration,
    // and env inheritance expands rules into child envs at read time), so a
    // rule whose envs intersect the touched set is split: touched envs are
    // removed from its scope and untouched envs keep it unchanged.
    const preservedRules: FeatureRule[] = (feature.rules ?? []).flatMap((r) => {
      // Footprint mirrors `ruleFootprint`: allEnvironments / undefined =
      // every applicable env; explicit list = that list (orphan envs kept).
      const isWildcard = r.allEnvironments || r.environments === undefined;
      const footprint = isWildcard ? applicableEnvIds : (r.environments ?? []);
      const remaining = footprint.filter((e) => !rulesTouchedEnvs.has(e));
      // No-env "pending" rules and untouched rules pass through unchanged.
      if (remaining.length === footprint.length) return [r];
      if (remaining.length === 0) return [];
      // Splitting a wildcard rule pins it to an explicit env list: envs added
      // to the org later will no longer pick it up automatically. That scope
      // narrowing is inherent to per-env edits of a shared rule, so log it
      // for operators debugging unexpected coverage gaps.
      if (isWildcard) {
        logger.warn(
          {
            organization: req.context.org.id,
            featureId: feature.id,
            ruleId: r.id,
            remainingEnvs: remaining,
          },
          "v1 feature update narrowed an all-environments rule to an explicit environment list",
        );
      }
      return [
        {
          ...r,
          allEnvironments: false,
          environments: remaining,
        } as FeatureRule,
      ];
    });

    // Re-merge inbound rules into preserved ones when a client round-trips
    // the same rule (matching id stem + content) so a shared rule stays a
    // single entry instead of splitting into per-env copies.
    const ruleContentEqual = (a: FeatureRule, b: FeatureRule) =>
      isEqual(
        omit(a, ["id", "environments", "allEnvironments"]),
        omit(b, ["id", "environments", "allEnvironments"]),
      );
    // Keep merged env lists in org env order (unknown/orphan envs last) so
    // re-merging a round-tripped rule is order-stable and diff-free.
    const orgEnvOrder = getEnvironments(req.context.org).map((e) => e.id);
    const orgEnvOrderSet = new Set(orgEnvOrder);
    const canonicalizeEnvs = (envs: string[]) => {
      const envSet = new Set(envs);
      return [
        ...orgEnvOrder.filter((e) => envSet.has(e)),
        ...envs.filter((e) => !orgEnvOrderSet.has(e)),
      ];
    };
    const revisedRulesFlat: FeatureRule[] = [...preservedRules];
    for (const inbound of inboundFlatRules) {
      const matchIndex = inbound.allEnvironments
        ? -1
        : revisedRulesFlat.findIndex(
            (r) =>
              !r.allEnvironments &&
              !!r.id &&
              !!inbound.id &&
              stemRuleId(r.id) === stemRuleId(inbound.id) &&
              ruleContentEqual(r, inbound),
          );
      if (matchIndex >= 0) {
        const existing = revisedRulesFlat[matchIndex];
        const envSet = new Set(existing.environments ?? []);
        const mergedEnvs = [
          ...(existing.environments ?? []),
          ...(inbound.environments ?? []).filter((e) => !envSet.has(e)),
        ];
        revisedRulesFlat[matchIndex] = {
          ...existing,
          environments: canonicalizeEnvs(mergedEnvs),
        } as FeatureRule;
      } else {
        revisedRulesFlat.push(inbound);
      }
    }

    const changedRuleEnvironments: string[] = [];
    let defaultValueChanged = false;

    if (
      updates.defaultValue !== undefined &&
      updates.defaultValue !== feature.defaultValue
    ) {
      defaultValueChanged = true;
    }
    // Only envs whose rules the caller replaced can change — untouched envs
    // are carried through by construction. Compare per-env projections with
    // scoping fields stripped: removing env B from a shared rule changes the
    // rule object's `environments` list without changing what env A serves.
    const ruleContentForEnv = (rules: FeatureRule[], env: string) =>
      getRulesForEnvironment(rules, env).map((r) =>
        omit(r, ["id", "environments", "allEnvironments"]),
      );
    rulesTouchedEnvs.forEach((env) => {
      if (
        !isEqual(
          ruleContentForEnv(revisedRulesFlat, env),
          ruleContentForEnv(feature.rules ?? [], env),
        )
      ) {
        changedRuleEnvironments.push(env);
      }
    });

    // 3. metadata
    const { metadata: metadataChanges, remaining: updatesAfterMetadata } =
      extractRevisionMetadata(updates);
    updates = updatesAfterMetadata;

    // 4. prerequisites
    const newPrerequisites = updates.prerequisites ?? null;
    if (newPrerequisites !== null) {
      delete updates.prerequisites;
    }

    // 5. archived
    const newArchived =
      updates.archived !== undefined && updates.archived !== feature.archived
        ? updates.archived
        : null;
    if (newArchived !== null) {
      delete updates.archived;
    }

    // 6. holdout — absent: no change; null: remove; { id, value }: add/change
    const holdoutFieldProvided = "holdout" in req.body;
    const newHoldout = holdoutFieldProvided
      ? (req.body.holdout ?? null)
      : undefined;
    const hasHoldoutChange =
      holdoutFieldProvided &&
      !isEqual(newHoldout ?? null, feature.holdout ?? null);

    // Determine whether any revision-tracked change exists
    const hasEnvEnabledChanges = Object.keys(changedEnvEnabled).length > 0;
    const hasRuleChanges =
      defaultValueChanged || changedRuleEnvironments.length > 0;
    const hasMetadataChanges = Object.keys(metadataChanges).length > 0;
    const hasPrereqChanges = newPrerequisites !== null;
    const hasArchivedChange = newArchived !== null;
    // Set when this request lands a live revision; dispatched after the commit.
    // Gates this request stepped over, named in the response like every other publish
    // surface — without it a caller cannot tell a publish that needed no approval from
    // one that bypassed a live requirement.
    const bypassedGates: BypassedGate[] = [];

    const hasRevisionChanges =
      hasEnvEnabledChanges ||
      hasRuleChanges ||
      hasMetadataChanges ||
      hasPrereqChanges ||
      hasArchivedChange ||
      hasHoldoutChange;

    if (hasRevisionChanges) {
      const revisionChanges: Partial<FeatureRevisionInterface> = {
        ...(hasEnvEnabledChanges
          ? { environmentsEnabled: changedEnvEnabled }
          : {}),
        ...(hasRuleChanges || hasEnvEnabledChanges
          ? {
              rules: revisedRulesFlat,
              ...(updates.defaultValue !== undefined
                ? { defaultValue: updates.defaultValue }
                : {}),
            }
          : {}),
        ...(hasMetadataChanges ? { metadata: metadataChanges } : {}),
        ...(hasPrereqChanges ? { prerequisites: newPrerequisites } : {}),
        ...(hasArchivedChange ? { archived: newArchived } : {}),
        ...(hasHoldoutChange ? { holdout: newHoldout ?? null } : {}),
      };

      // Throws if the revision requires approval and the caller cannot bypass.
      const {
        revision,
        updatedFeature: updatedFeatureFromRevision,
        bypassedApproval,
      } = await createAndPublishRevision({
        context: req.context,
        feature,
        user: req.eventAudit,
        org: req.organization,
        changes: revisionChanges,
        comment: "Created via REST API",
        canBypassApprovalChecks: canBypass,
      });

      Object.assign(feature, updatedFeatureFromRevision);
      updates.version = revision.version;

      // This path creates AND publishes a live revision, so it owes the same
      // `revision.published` webhook the dedicated publish endpoints emit. Without it
      // a consumer mirroring revision state sees the version advance with no publish
      // event — the only feature path that landed a revision silently.

      // Dispatched HERE, immediately after the revision commits — not at the end of
      // the handler. The publish is already live at this point; everything between
      // (the metadata write, the tags diff, the audit entry, and four reads for the
      // response payload) can throw, and every one of them turned a live publish into
      // a 500 with no lifecycle event at all. Those later steps are not part of the
      // publish, so their failure does not make this event untrue.
      //
      // Best-effort, as before: a failed notification must not fail a committed write.
      try {
        await dispatchFeatureRevisionEvent(
          req.context,
          feature,
          await getPublishedRevisionForEvents(req.context, feature, revision),
          "revision.published",
          {},
        );
      } catch (e) {
        logger.error(
          e,
          `Failed to dispatch revision.published for feature ${feature.id}`,
        );
      }
      if (bypassedApproval) {
        bypassedGates.push({
          type: "approval-required",
          outcome: "bypassed",
          // `canBypass` ORs the two sources, so it cannot name which one applied.
          // Ask the org setting directly; the permission is what remains.
          via: canUseRestApiBypassSetting(req)
            ? "restApiBypassesReviews"
            : "bypassApprovalPermission",
        });
      }

      // The enabled flips were excluded from the direct-write `updates` above
      // (frozen to their pre-update values) so they apply exactly once, via
      // the revision publish. The direct write below runs after the publish,
      // so re-sync the frozen values from the published feature state.
      if (updates.environmentSettings) {
        for (const env of Object.keys(changedEnvEnabled)) {
          updates.environmentSettings[env] = {
            ...updates.environmentSettings[env],
            enabled:
              feature.environmentSettings?.[env]?.enabled ??
              changedEnvEnabled[env],
          };
        }
      }
    }

    const updatedFeature = await updateFeatureToDb(
      req.context,
      feature,
      updates,
    );

    await addTagsDiff(
      req.context.org.id,
      feature.tags || [],
      newTagsForDiff || [],
    );

    await req.audit({
      event: "feature.update",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature),
    });

    const groupMap = await getSavedGroupMap(req.context);

    const experimentMap = await getExperimentMapForFeature(
      req.context,
      feature.id,
    );
    const revision = await getRevision({
      context: req.context,
      organization: updatedFeature.organization,
      featureId: updatedFeature.id,
      feature: updatedFeature,
      version: updatedFeature.version,
    });
    const safeRolloutMap =
      await req.context.models.safeRollout.getAllPayloadSafeRollouts();
    return {
      feature: await resolveOwnerEmail(
        getApiFeatureObj({
          feature: updatedFeature,
          organization: req.organization,
          groupMap,
          experimentMap,
          revision,
          safeRolloutMap,
        }),
        req.context,
      ),
      ...(bypassedGates.length ? { bypassedGates } : {}),
    };
  },
);
