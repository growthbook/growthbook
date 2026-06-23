import {
  archiveConstantValidator,
  unarchiveConstantValidator,
} from "shared/validators";
import { ConstantInterface } from "shared/types/constant";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

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
  id: string,
  archived: boolean,
) {
  const constant = await context.models.constants.getById(id);
  if (!constant) {
    throw new NotFoundError(`Unable to locate the constant: ${id}`);
  }

  if (!context.permissions.canUpdateConstant(constant, constant)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: skip the write if already in the desired state.
  if (!!constant.archived === archived) {
    return buildResponse(context, constant);
  }

  // Unlike saved groups, archiving a referenced constant is allowed — while
  // archived, its references are stripped from the SDK payload (string interps
  // removed, JSON refs dropped) rather than resolving to a value.
  const updated = await context.models.constants.update(constant, { archived });
  return buildResponse(context, { ...constant, ...updated });
}

export const archiveConstant = createApiRequestHandler(
  archiveConstantValidator,
)(async (req) => setArchivedState(req.context, req.params.id, true));

export const unarchiveConstant = createApiRequestHandler(
  unarchiveConstantValidator,
)(async (req) => setArchivedState(req.context, req.params.id, false));
