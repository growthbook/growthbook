import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
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
  const createdById =
    rev.createdBy?.type === "dashboard" ? rev.createdBy.id : null;

  // contributors is now string[] (user IDs). For older revisions that lack
  // the field, fall back to deriving from content-bearing log entries.
  const storedIds = (rev.contributors ?? []).filter(Boolean);

  const coAuthorIds =
    storedIds.length === 0 && logs
      ? logs
          .filter(
            (l) =>
              !NON_CONTENT_ACTIONS.has(l.action) &&
              l.user?.type === "dashboard" &&
              l.user.id !== createdById,
          )
          .map((l) => (l.user as { id: string }).id)
          .filter((id, i, arr) => arr.indexOf(id) === i)
      : storedIds.filter((id) => id !== createdById);

  return <CoAuthorsList coAuthorIds={coAuthorIds} {...marginProps} />;
}
