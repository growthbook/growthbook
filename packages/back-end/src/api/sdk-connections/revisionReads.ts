import type { z } from "zod";
import {
  getSdkConnectionRevisionLatestValidator,
  getSdkConnectionRevisionMergeStatusValidator,
  getSdkConnectionRevisionValidator,
  getSdkConnectionRevisionsValidator,
  listSdkConnectionRevisionsValidator,
} from "shared/validators";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { stringToBoolean } from "shared/util";
import { ApiReqContext } from "back-end/types/api";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import { getAdapter } from "back-end/src/revisions";
import { scrubConflictsForViewer } from "back-end/src/revisions/scrub";
import {
  assertUserScopedKeyForMine,
  buildRevisionStatusFilter,
} from "back-end/src/api/revisionValidations";
import {
  TYPE,
  loadConnection,
  loadConnectionAndRevision,
  toApiSdkConnectionRevision,
} from "./revisionShared";

type ListQuery = z.infer<typeof getSdkConnectionRevisionsValidator.querySchema>;

// One page of revisions, for one connection or for every readable one.
async function revisionPage(
  context: ApiReqContext,
  query: ListQuery,
  connectionId?: string,
) {
  const mine = stringToBoolean(query.mine?.toString());
  assertUserScopedKeyForMine(context, mine);
  if (mine && query.author) {
    throw new BadRequestError("`mine` and `author` cannot be used together");
  }

  const skipPagination = stringToBoolean(query.skipPagination?.toString());
  if (skipPagination && !API_ALLOW_SKIP_PAGINATION) {
    throw new BadRequestError(
      "skipPagination is not allowed. Set API_ALLOW_SKIP_PAGINATION=true in API environment variables. Self-hosted only.",
    );
  }
  const { limit, offset } = skipPagination
    ? { limit: 0, offset: 0 }
    : validatePagination(query);

  const { revisions, total } =
    await context.models.revisions.getByTargetTypePaginated(TYPE, {
      entityId: connectionId,
      status: buildRevisionStatusFilter(query.status),
      authorId: mine ? context.actingUserId : query.author,
      limit: skipPagination ? undefined : limit,
      skip: skipPagination ? undefined : offset,
    });

  const hasMore = !skipPagination && offset + limit < total;
  return {
    revisions: await Promise.all(
      revisions.map((r) =>
        toApiSdkConnectionRevision(context, r, { withHeaders: true }),
      ),
    ),
    limit: skipPagination ? total : limit,
    offset,
    count: revisions.length,
    total,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

export const listSdkConnectionRevisions = createApiRequestHandler(
  listSdkConnectionRevisionsValidator,
)(async ({ context, query: { sdkConnectionId, ...query } }) =>
  revisionPage(context, query, sdkConnectionId),
);

export const getSdkConnectionRevisions = createApiRequestHandler(
  getSdkConnectionRevisionsValidator,
)(async (req) => {
  const { live } = await loadConnection(req.context, req.params.id);
  return revisionPage(req.context, req.query, live.id);
});

export const getSdkConnectionRevisionLatest = createApiRequestHandler(
  getSdkConnectionRevisionLatestValidator,
)(async (req) => {
  const { live } = await loadConnection(req.context, req.params.id);

  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  const revision = await req.context.models.revisions.getLatestOpenByTarget(
    TYPE,
    live.id,
    { authorId: mine ? req.context.actingUserId : undefined },
  );
  if (!revision) {
    throw new NotFoundError(
      mine
        ? "No active draft revision found for this SDK Connection where you are the author"
        : "No active draft revision found for this SDK Connection",
    );
  }
  return {
    revision: await toApiSdkConnectionRevision(req.context, revision, {
      withHeaders: true,
    }),
  };
});

export const getSdkConnectionRevision = createApiRequestHandler(
  getSdkConnectionRevisionValidator,
)(async (req) => {
  const { revision } = await loadConnectionAndRevision(req.context, req.params);
  return {
    revision: await toApiSdkConnectionRevision(req.context, revision, {
      withHeaders: true,
    }),
  };
});

export const getSdkConnectionRevisionMergeStatus = createApiRequestHandler(
  getSdkConnectionRevisionMergeStatusValidator,
)(async (req) => {
  const { live, revision } = await loadConnectionAndRevision(
    req.context,
    req.params,
  );
  const result = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    live,
    normalizeProposedChanges(revision.target.proposedChanges),
    getAdapter(TYPE).getUpdatableFields(),
  );
  return {
    success: result.success,
    hasConflicts: result.conflicts.length > 0,
    conflicts: await scrubConflictsForViewer(
      req.context,
      revision.target,
      result.conflicts,
    ),
    canAutoMerge: result.canAutoMerge,
  };
});
