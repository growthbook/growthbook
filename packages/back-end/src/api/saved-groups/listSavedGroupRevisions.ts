import { listSavedGroupRevisionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import {
  assertUserScopedKeyForMine,
  buildRevisionStatusFilter,
} from "./validations";
import { toApiSavedGroupRevisions } from "./toApiSavedGroupRevision";

/**
 * Cross-saved-group revision listing. Mirrors `getSavedGroupRevisions` but
 * scopes by `target.type === "saved-group"` instead of a single saved group;
 * an optional `savedGroupId` query param narrows the result set.
 *
 * Per-document read permission is enforced by `RevisionModel.canRead` (which
 * delegates to the saved-group adapter's `canRead`), so callers without
 * permission to read a saved group will not see its revisions in the response.
 */
export const listSavedGroupRevisions = createApiRequestHandler(
  listSavedGroupRevisionsValidator,
)(async (req) => {
  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  if (mine && req.query.author) {
    // Mutually exclusive — passing both is almost certainly a caller mistake.
    // Mirrors the per-saved-group listing handler.
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
    await req.context.models.revisions.getByTargetTypePaginated("saved-group", {
      entityId: req.query.savedGroupId,
      authorId,
      status,
      limit: skipPagination ? undefined : limit,
      skip: skipPagination ? undefined : offset,
    });

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
