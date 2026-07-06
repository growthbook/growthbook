import { listConfigRevisionsValidator } from "shared/validators";
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
import { toApiConfigRevisions } from "./toApiConfigRevision";

// Read permission is enforced per-document by RevisionModel.canRead, so callers
// only see revisions for configs they can read.
export const listConfigRevisions = createApiRequestHandler(
  listConfigRevisionsValidator,
)(async (req) => {
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

  // Resolve the public key to the internal id the revision store indexes on.
  // An unknown key matches no config → no results.
  let entityId: string | undefined;
  if (req.query.key) {
    const config = await req.context.models.configs.getByKey(req.query.key);
    if (!config) {
      return {
        revisions: [],
        limit: skipPagination ? 0 : limit,
        offset,
        count: 0,
        total: 0,
        hasMore: false,
        nextOffset: null,
      };
    }
    entityId = config.id;
  }

  const { revisions, total } =
    await req.context.models.revisions.getByTargetTypePaginated("config", {
      entityId,
      authorId,
      status,
      limit: skipPagination ? undefined : limit,
      skip: skipPagination ? undefined : offset,
    });

  const apiRevisions = await toApiConfigRevisions(revisions, req.context);

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
