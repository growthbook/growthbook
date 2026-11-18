import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import Owner from "@/components/Avatar/Owner";
import { revisionFacts } from "@/components/Features/revisionFacts";
import RevisionDetailsCard from "@/components/Reviews/RevisionDetailsCard";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";

// What the revision selector shows about a revision on hover.
export default function FeatureRevisionDetails({
  revision,
  liveVersion,
}: {
  revision: MinimalFeatureRevisionInterface;
  liveVersion: number;
}) {
  return (
    <RevisionDetailsCard
      version={revision.version}
      title={revision.title}
      badge={
        <RevisionStatusBadge revision={revision} liveVersion={liveVersion} />
      }
      facts={revisionFacts(revision, liveVersion, (id) => (
        <Owner ownerId={id} gap="1" size="sm" truncate />
      ))}
      comment={revision.comment}
    />
  );
}
