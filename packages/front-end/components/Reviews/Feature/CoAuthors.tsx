import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { eventUserIdentity, revisionActor } from "shared/validators";
import CoAuthorsList from "@/components/Reviews/CoAuthorsList";

// Actions that carry no content change — excluded when deriving co-authors from logs.
export const NON_CONTENT_ACTIONS = new Set([
  "Review Requested",
  "Approved",
  "Requested Changes",
  "Comment",
  "edit comment",
  "publish",
  "re-publish",
  "discard",
]);

interface Props extends MarginProps {
  rev: FeatureRevisionInterface;
  // When provided and rev.contributors is empty, co-authors are derived from
  // content-bearing log entries as a fallback for older revisions.
  logs?: RevisionLog[];
}

export default function CoAuthors({ rev, logs, ...marginProps }: Props) {
  const createdById = eventUserIdentity(rev.createdBy ?? null);

  // Contributors are identities (members, or keys that acted as themselves).
  // Older revisions without the field derive them from content-bearing logs.
  const storedIds = (rev.contributors ?? []).filter(Boolean);

  const coAuthorIds =
    storedIds.length === 0 && logs
      ? logs
          .filter((l) => !NON_CONTENT_ACTIONS.has(l.action))
          .map((l) => eventUserIdentity(l.user ?? null))
          .filter((id): id is string => !!id && id !== createdById)
          .filter((id, i, arr) => arr.indexOf(id) === i)
      : storedIds.filter((id) => id !== createdById);

  return (
    <CoAuthorsList
      coAuthorIds={coAuthorIds}
      actorFor={(id) =>
        revisionActor(
          {
            createdBy: rev.createdBy ?? undefined,
            reviews: rev.reviews,
            activityLog: logs,
          },
          id,
        )
      }
      {...marginProps}
    />
  );
}
