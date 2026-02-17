import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import Badge from "@/ui/Badge";

export interface Props {
  revision: MinimalFeatureRevisionInterface | null | undefined;
  liveVersion: number;
}

export default function RevisionStatusBadge({ revision, liveVersion }: Props) {
  if (!revision) return null;
  if (revision.version === liveVersion) {
    return <Badge label="Live" radius="full" color="teal" />;
  }
  switch (revision.status) {
    case "draft":
      return <Badge label="Draft" radius="full" color="indigo" />;
    case "published":
      return <Badge label="Locked" radius="full" color="gray" />;
    case "discarded":
      return <Badge label="Discarded" radius="full" color="red" />;
    case "pending-review":
    case "changes-requested":
    case "approved":
      return <Badge label={revision.status} radius="full" color="gray" />;
    default:
      return null;
  }
}
