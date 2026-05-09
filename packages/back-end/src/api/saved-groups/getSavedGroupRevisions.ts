import { getSavedGroupRevisionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import { assertUserScopedKeyForMine } from "./validations";
import { toApiSavedGroupRevisions } from "./toApiSavedGroupRevision";

// Translate the public `status` query (which accepts comma-separated lists or
// the `open` shortcut) into the model's filter shape.
function buildStatusFilter(input?: string): string | string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.includes("open")) {
    // The model maps the `open` shortcut to its own non-terminal set; passing
    // it through as a string lets the model honour that shortcut.
    return "open";
  }
  return parts.length === 1 ? parts[0] : parts;
}

export const getSavedGroupRevisions = createApiRequestHandler(
  getSavedGroupRevisionsValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.id,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  if (mine && req.query.author) {
    // The two filters are mutually exclusive — passing both is almost
    // certainly a caller mistake. Mirrors PR #5607 listRevisions.
    throw new Error("`mine` and `author` cannot be used together");
  }

  const skipPagination = stringToBoolean(req.query.skipPagination?.toString());
  if (skipPagination && !API_ALLOW_SKIP_PAGINATION) {
    throw new Error(
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
  const status = buildStatusFilter(req.query.status);

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
