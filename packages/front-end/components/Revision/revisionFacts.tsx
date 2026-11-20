import { Fragment, ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { ago, datetime } from "shared/dates";
import { Revision } from "shared/enterprise";
import { isActiveDraftStatus, revisionActor } from "shared/validators";
import {
  RevisionFact,
  revisionActorValue,
} from "@/components/Features/revisionFacts";

// The generic revision model's details, in the order a feature revision's are
// listed.
export function revisionModelFacts(
  revision: Revision,
  // A teammate, drawn as the list draws people.
  person: (id: string) => ReactNode,
): RevisionFact[] {
  const facts: RevisionFact[] = [];
  const isDraft = isActiveDraftStatus(revision.status);

  facts.push({
    label: "Revised by",
    value: revisionActorValue(
      revisionActor(revision, revision.authorId),
      person,
    ),
  });

  const coAuthorIds = (revision.contributors ?? []).filter(
    (id) => id !== revision.authorId,
  );
  if (coAuthorIds.length > 0) {
    facts.push({
      label: coAuthorIds.length === 1 ? "Co-author" : "Co-authors",
      value: (
        <Flex direction="column" gap="1">
          {coAuthorIds.map((id) => (
            <Fragment key={id}>
              {revisionActorValue(revisionActor(revision, id), person)}
            </Fragment>
          ))}
        </Flex>
      ),
    });
  }

  facts.push(
    revision.status === "merged" && revision.resolution
      ? { label: "Published", value: datetime(revision.resolution.dateCreated) }
      : { label: "Last update", value: ago(revision.dateUpdated) },
  );

  if (isDraft && revision.scheduledPublishAt) {
    facts.push({
      label: "Publishes",
      value: datetime(revision.scheduledPublishAt),
    });
  }

  return facts;
}

// When a revision last changed: published revisions by their publish date.
export function revisionModelDate(revision: Revision): Date {
  return revision.status === "merged" && revision.resolution
    ? revision.resolution.dateCreated
    : revision.dateUpdated;
}
