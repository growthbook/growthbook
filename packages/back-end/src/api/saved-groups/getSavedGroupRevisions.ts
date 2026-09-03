import { getSavedGroupRevisionsValidator } from "shared/validators";
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
import { toApiSavedGroupRevisions } from "./toApiSavedGroupRevision";

export const getSavedGroupRevisions = createApiRequestHandler(
  getSavedGroupRevisionsValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
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

  let limit: number;
  let offset: number;
  if (skipPagination) {
    limit = req.query.limit ?? 10;
    offset = req.query.offset ?? 0;
  } else {
    ({ limit, offset } = validatePagination(req.query));
  }

  const authorId = mine ? req.context.userId : req.query.author;
  const status = buildRevisionStatusFilter(req.query.status);

  const { revisions, total } =
    await req.context.models.revisions.getByTargetPaginated(
      "saved-group",
      savedGroup.id,
      {
        status,
        authorId,
        limit: skipPagination ? undefined : limit,
        skip: skipPagination ? undefined : offset,
      },
    );

  const apiRevisions = await toApiSavedGroupRevisions(revisions, req.context);

  const hasMore = skipPagination ? false : offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;
  const outLimit = skipPagination ? total : limit;
  const outOffset = skipPagination ? 0 : offset;

  return {
    revisions: apiRevisions,
    limit: outLimit,
    offset: outOffset,
    count: apiRevisions.length,
    total,
    hasMore,
    nextOffset,
  };
});
