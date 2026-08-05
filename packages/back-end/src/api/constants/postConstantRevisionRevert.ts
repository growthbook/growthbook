import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { isEqual } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import {
  postConstantRevisionRevertValidator,
  constantUpdatableFieldsSchema,
} from "shared/validators";
import {
  revertRevision,
  resolveRevertStrategy,
} from "back-end/src/revisions/revertActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { constantPublishEnvironments } from "back-end/src/revisions/revisionPublishEnvironments";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";
import { assertConstantArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { assertConstantPublishGuards } from "back-end/src/services/publishGuards";
import { constantChangeAffectsServedValue } from "back-end/src/services/experimentGuard";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRevert = createApiRequestHandler(
  postConstantRevisionRevertValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find Constant");
  }

  const adapter = getAdapter("constant");
  const revertsBypassApproval =
    !!req.organization.settings?.revertsBypassApproval;
  const strategy = resolveRevertStrategy(
    req.body.strategy,
    revertsBypassApproval,
  );

  const targetRevision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  if (targetRevision.status !== "merged") {
    throw new BadRequestError(
      "Can only revert to a published (merged) revision. " +
        `Revision #${req.params.version} has status "${targetRevision.status}".`,
    );
  }

  // Reconstruct the constant's state at the time of the historical revision
  // (base snapshot + its proposed changes = post-merge state).
  const targetState = applyPatchToSnapshot(
    targetRevision.target.snapshot as ConstantInterface,
    targetRevision.target.proposedChanges,
  ) as ConstantInterface;

  // Executing the revert needs revert authority over the environments whose
  // override the restoration changes; a differing base value carries no
  // intrinsic environment, matching every other landing. Proposing a draft is
  // also open to anyone who can author drafts.
  const revertEnvs = [
    ...new Set([
      ...Object.keys(constant.environmentValues ?? {}),
      ...Object.keys(targetState.environmentValues ?? {}),
    ]),
  ].filter(
    (env) =>
      (constant.environmentValues?.[env] ?? "") !==
      (targetState.environmentValues?.[env] ?? ""),
  );
  // Coarse standing before the reconstruction; assertCanRevertRevision below is
  // authoritative once the change set is known. Subset-refusing.
  if (
    (["revert", "draft"] as const).every(
      (action) =>
        !req.context.permissions.canRevisionAction(
          "constant",
          action,
          constant,
          NO_ENVIRONMENT_BINDING,
        ),
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Diff vs the current live constant; omit fields equal to live.
  const fieldsToUpdate: Record<string, unknown> = {};
  for (const field of Object.keys(constantUpdatableFieldsSchema.shape)) {
    const targetValue = (targetState as Record<string, unknown>)[field];
    const liveValue = (constant as unknown as Record<string, unknown>)[field];
    if (isEqual(targetValue, liveValue)) continue;
    if (targetValue !== undefined) {
      fieldsToUpdate[field] = targetValue;
    } else if (field === "environmentValues") {
      // Absent in target but set live → clear the per-env overrides.
      fieldsToUpdate[field] = {};
    }
    // Other optional fields absent in the target are left as-is.
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new BadRequestError(
      `Revision #${req.params.version} matches the current Constant — nothing to revert.`,
    );
  }

  // Reverting to a historically-archived state re-archives the constant; enforce
  // the same soft referenced-constant warning as the archive endpoint (bypassable
  // by ignoreWarnings). Only the archive transition is guarded. Mirrors the config twin.
  // Authoritative: the revert atom over the right scope for this mode, plus a
  // relocation's destination and an archive restore's delete atom.
  const patchOps: JsonPatchOperation[] = Object.entries(fieldsToUpdate).map(
    ([key, value]) => ({ op: "replace" as const, path: `/${key}`, value }),
  );

  const title = req.body.title ?? `Revert to v${req.params.version}`;

  const { revision: result } = await revertRevision({
    context: req.context,
    entityType: "constant",
    entity: constant as unknown as Record<string, unknown> & { id: string },
    targetRevision,
    strategy,
    fields: fieldsToUpdate,
    patchOps,
    footprint: constantPublishEnvironments(req.context, revertEnvs),
    title,
    // Approval for this landing, resolved by the pipeline after authority.
    resolveApproval: async () => {
      const approvalRequired = revertsBypassApproval
        ? false
        : adapter.isApprovalRequiredForRevision
          ? adapter.isApprovalRequiredForRevision(req.context, {
              target: { snapshot: constant, proposedChanges: patchOps },
            } as unknown as Revision)
          : adapter.isApprovalRequired(req.context);
      const canBypass =
        canUseRestApiBypassSetting(req) ||
        adapter.canBypassApproval(
          req.context,
          constant as Record<string, unknown>,
        );
      if (approvalRequired && !canBypass) {
        throw new BadRequestError(
          "This revert requires approval before changes can be published. " +
            'Use `strategy: "draft"` to create a draft for review, ' +
            "or use a role/token that grants FlagsBypassApprovals.",
        );
      }
      return { approvalRequired, canBypass };
    },
    // Guards that only bite on landing: taking the Constant out of service, and
    // the value guards a live rewrite must clear. A metadata-only revert cannot
    // rewrite a served value.
    assertLandable: async () => {
      if (fieldsToUpdate.archived === true && !constant.archived) {
        await assertConstantArchiveDependentsGuard(
          req.context,
          { id: constant.id, key: constant.key, project: constant.project },
          { armed: false },
        );
      }
      if (!constantChangeAffectsServedValue(Object.keys(fieldsToUpdate)))
        return;
      await assertConstantPublishGuards(
        req.context,
        constant,
        targetRevision,
        { armed: false },
        (fieldsToUpdate.value as string | undefined) ?? constant.value,
        "environmentValues" in fieldsToUpdate
          ? (fieldsToUpdate.environmentValues as Record<string, string>)
          : constant.environmentValues,
        // A revert that flips archived scrubs (or restores) refs — model the
        // transition so dependents' schema breaks are checked.
        "archived" in fieldsToUpdate ? !!fieldsToUpdate.archived : undefined,
      );
    },
  });

  return { revision: await toApiConstantRevision(result, req.context) };
});
