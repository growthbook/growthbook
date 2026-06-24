import { Revision } from "shared/enterprise";
import {
  archiveConstantValidator,
  unarchiveConstantValidator,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { assertConstantArchivable } from "back-end/src/services/constants";

async function buildResponse(
  context: ApiReqContext,
  constant: ConstantInterface,
) {
  return {
    constant: await resolveOwnerEmail(
      context.models.constants.toApiInterface(constant),
      context,
    ),
  };
}

async function setArchivedState(
  context: ApiReqContext,
  key: string,
  archived: boolean,
) {
  const constant = await context.models.constants.getByKey(key);
  if (!constant) {
    throw new NotFoundError(`Unable to locate the constant: ${key}`);
  }

  if (!context.permissions.canUpdateConstant(constant, constant)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: skip the write if already in the desired state.
  if (!!constant.archived === archived) {
    return buildResponse(context, constant);
  }

  // Block archiving a still-referenced constant (parity with saved groups and
  // the internal/UI archive flow). Unarchiving is always allowed.
  if (archived) {
    await assertConstantArchivable(context, constant.id);
  }

  // Archiving/unarchiving is a metadata-only change to the constant. Respect the
  // same approval gate as the dashboard archive flow and the REST update
  // endpoint — otherwise these endpoints would be a way to bypass required
  // (metadata) reviews. These endpoints take no body, so bypass is only via the
  // org's `restApiBypassesReviews` setting or the caller's bypass permission.
  const adapter = getAdapter("constant");
  const patchOps = buildPatchOps({ archived });
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, {
        target: { snapshot: constant, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(context);

  // Unlike saved groups, archiving a referenced constant is allowed — while
  // archived, its references are stripped from the SDK payload (string interps
  // removed, JSON refs dropped) rather than resolving to a value.
  if (approvalRequired) {
    const canBypass =
      !!context.org.settings?.restApiBypassesReviews ||
      adapter.canBypassApproval(context, constant);
    if (!canBypass) {
      throw new BadRequestError(
        "This organization requires approvals for this constant. " +
          `Use \`POST /constants-revisions/${constant.key}\` to ${
            archived ? "archive" : "unarchive"
          } it through a draft, or use a role/token with the bypass permission.`,
      );
    }
    // Persist the live change, then record it as an already-merged revision so
    // the bypass is auditable (mirrors the REST update + internal controller).
    await ensureLiveRevisionExists(
      context,
      "constant",
      constant as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );
    const updated = await context.models.constants.update(constant, {
      archived,
    });
    const merged = await context.models.revisions.createMerged({
      type: "constant",
      id: constant.id,
      snapshot: constant as unknown as Record<string, unknown>,
      proposedChanges: patchOps,
      bypass: true,
    });
    await dispatchConstantRevisionEvent(context, merged, { type: "published" });
    return buildResponse(context, { ...constant, ...updated });
  }

  const updated = await context.models.constants.update(constant, { archived });
  return buildResponse(context, { ...constant, ...updated });
}

export const archiveConstant = createApiRequestHandler(
  archiveConstantValidator,
)(async (req) => setArchivedState(req.context, req.params.key, true));

export const unarchiveConstant = createApiRequestHandler(
  unarchiveConstantValidator,
)(async (req) => setArchivedState(req.context, req.params.key, false));
