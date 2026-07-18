import { Revision } from "shared/enterprise";
import {
  archiveConstantValidator,
  unarchiveConstantValidator,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  evaluatePublishGates,
  PublishBlockedError,
  PublishGate,
  BypassedGate,
} from "back-end/src/revisions/publishGates";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";

async function buildResponse(
  context: ApiReqContext,
  constant: ConstantInterface,
  bypassed: BypassedGate[],
) {
  return {
    constant: await resolveOwnerEmail(
      context.models.constants.toApiInterface(constant),
      context,
    ),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
}

async function setArchivedState(
  req: Pick<ApiRequestLocals, "context" | "isJwtAuth">,
  key: string,
  archived: boolean,
) {
  const { context } = req;
  const constant = await context.models.constants.getByKey(key);
  if (!constant) {
    throw new NotFoundError(`Unable to locate the constant: ${key}`);
  }

  if (!context.permissions.canUpdateConstant(constant, constant)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: skip the write if already in the desired state.
  if (!!constant.archived === archived) {
    return buildResponse(context, constant, []);
  }

  const adapter = getAdapter("constant");
  const patchOps = buildPatchOps({ archived });
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, {
        target: { snapshot: constant, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(context);
  const canBypass =
    canUseRestApiBypassSetting(req) ||
    adapter.canBypassApproval(
      context,
      constant as unknown as Record<string, unknown>,
    );

  // Aggregate every publish gate into one structured 422 (same contract as the
  // revision-publish endpoints). Unlike configs, a constant has no revision pin,
  // so there's no config-locked gate here.
  const gates: PublishGate[] = [];
  // Metadata-only, but still gated so it can't bypass a required metadata review.
  // No draft to approve here, so the resolution routes through a draft revision.
  if (approvalRequired) {
    gates.push({
      type: "approval-required",
      severity: "blocker",
      messages: [
        `This organization requires approval to ${
          archived ? "archive" : "unarchive"
        } this constant.`,
      ],
      override: null,
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "create-draft",
        method: "POST",
        path: `/constants-revisions/${constant.key}`,
      },
    });
  }
  // Soft guards (experiment / locked-dependent / schema-break / archive-dependents)
  // for the archived flip. Archived refs are scrubbed at resolution, so the
  // transition rewrites consumers' values even though the constant's own values
  // are unchanged.
  gates.push(
    ...((await adapter.collectPublishGates?.(
      context,
      constant,
      {
        target: { snapshot: constant, proposedChanges: patchOps },
      } as unknown as Revision,
      { archived },
    )) ?? []),
  );

  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: context.ignoreWarnings,
    skipSchemaValidation: context.skipSchemaValidation,
    bypassApprovalPermission: adapter.canBypassApproval(
      context,
      constant as Record<string, unknown>,
    ),
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    canForceMergeStaleBase: canBypass,
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
  }

  // Approval backstop behind the gate above.
  if (approvalRequired && !canBypass) {
    throw new BadRequestError(
      "This organization requires approvals for this constant. " +
        `Use \`POST /constants-revisions/${constant.key}\` to ${
          archived ? "archive" : "unarchive"
        } it through a draft, or use a role/token with the bypass permission.`,
    );
  }

  if (approvalRequired) {
    // Record the merged revision FIRST, then apply; roll it back if the apply
    // fails, so a merged record never lacks a live change.
    await ensureLiveRevisionExists(
      context,
      "constant",
      constant as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );
    const merged = await context.models.revisions.createMerged({
      type: "constant",
      id: constant.id,
      snapshot: constant as unknown as Record<string, unknown>,
      proposedChanges: patchOps,
      bypass: true,
    });
    let updated: Partial<ConstantInterface>;
    try {
      updated = await context.models.constants.update(constant, { archived });
    } catch (e) {
      try {
        await context.models.revisions.deleteById(merged.id);
      } catch {
        // ignore — surface the original update error
      }
      throw e;
    }
    await dispatchConstantRevisionEvent(context, merged, { type: "published" });
    return buildResponse(context, { ...constant, ...updated }, bypassed);
  }

  const updated = await context.models.constants.update(constant, { archived });
  return buildResponse(context, { ...constant, ...updated }, bypassed);
}

export const archiveConstant = createApiRequestHandler(
  archiveConstantValidator,
)(async (req) => setArchivedState(req, req.params.key, true));

export const unarchiveConstant = createApiRequestHandler(
  unarchiveConstantValidator,
)(async (req) => setArchivedState(req, req.params.key, false));
