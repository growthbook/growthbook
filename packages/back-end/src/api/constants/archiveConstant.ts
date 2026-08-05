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
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { getEnvironments } from "back-end/src/services/organizations";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
import { collectArchiveApprovalGate } from "back-end/src/revisions/governanceGates";
import { canLandArchivedState } from "back-end/src/revisions/archiveTransition";
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
    throw new NotFoundError(`Unable to locate the Constant: ${key}`);
  }

  // Archiving is delete-class; unarchiving returns the Constant to service and
  // is an ordinary publish.
  if (
    !canLandArchivedState({
      permissions: context.permissions,
      model: "constant",
      entity: constant,
      archived,
      // The serve footprint: archiving takes the base value out of EVERY
      // environment, so the delete atom must hold in all of them — the unbound
      // sentinel made this check vacuous for env-limited deleters.
      environments: getEnvironments(context.org).map((e) => e.id),
    })
  ) {
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
  // Metadata-only, but still gated so it can't bypass a required metadata
  // review. No draft to approve here, so the resolution routes through a
  // draft revision.
  const gates: PublishGate[] = collectArchiveApprovalGate({
    approvalRequired,
    archived,
    noun: "Constant",
    createDraftPath: `/constants-revisions/${constant.key}`,
    model: "constant",
  });
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
    skipSchemaValidation: context.canSkipSchemaValidationFor("constant"),
    skipHooks: context.canSkipHooksFor("constant"),
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
      "This organization requires approvals for this Constant. " +
        `Use \`POST /constants-revisions/${constant.key}\` to ${
          archived ? "archive" : "unarchive"
        } it through a draft, or use a role/token with the bypass permission.`,
    );
  }

  // One recorded, guarded landing whether or not approval was bypassed — this
  // used to fork into a hand-rolled copy of the pipeline on one side and a plain
  // unrecorded write on the other.
  await ensureLiveRevisionExists(
    context,
    "constant",
    constant as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );
  const { merged, result: updated } = await landDirectChange({
    context,
    entityType: "constant",
    entity: constant as unknown as Record<string, unknown> & { id: string },
    patchOps,
    bypass: approvalRequired,
    changes: { archived },
    write: () =>
      runGuardedWrite("constant", constant.id, () =>
        context.models.constants.updateIfUnchanged(constant, { archived }),
      ),
  });
  await dispatchConstantRevisionEvent(context, merged, { type: "published" });
  return buildResponse(context, { ...constant, ...updated }, bypassed);
}

export const archiveConstant = createApiRequestHandler(
  archiveConstantValidator,
)(async (req) => setArchivedState(req, req.params.key, true));

export const unarchiveConstant = createApiRequestHandler(
  unarchiveConstantValidator,
)(async (req) => setArchivedState(req, req.params.key, false));
