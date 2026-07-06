import { getConstantRevisionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import {
  assertUserScopedKeyForMine,
  buildRevisionStatusFilter,
} from "./validations";
import { toApiConstantRevisions } from "./toApiConstantRevision";

export const getConstantRevisions = createApiRequestHandler(
  getConstantRevisionsValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  if (mine && req.query.author) {
    throw new BadRequestError("`mine` and `author` cannot be used together");
  }

  const skipPagination = stringToBoolean(req.query.skipPagination?.toString());
  if (skipPagination && !API_ALLOW_SKIP_PAGINATION) {
    throw new BadRequestError(
      "skipPagination is not allowed. Set API_ALLOW_SKIP_PAGINATION=true in API environment variables. Self-hosted only.",
    );
  }

  let limit = 0;
  let offset = 0;
  if (!skipPagination) {
    ({ limit, offset } = validatePagination(req.query));
  }

  const authorId = mine ? req.context.userId : req.query.author;
  const status = buildRevisionStatusFilter(req.query.status);

  const { revisions, total } =
    await req.context.models.revisions.getByTargetPaginated(
      "constant",
      constant.id,
      {
        status,
        authorId,
        limit: skipPagination ? undefined : limit,
        skip: skipPagination ? undefined : offset,
      },
    );

  const apiRevisions = await toApiConstantRevisions(revisions, req.context);

  const hasMore = skipPagination ? false : offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;

  return {
    revisions: apiRevisions,
    limit: skipPagination ? total : limit,
    offset,
    count: apiRevisions.length,
    total,
    hasMore,
    nextOffset,
  };
});
