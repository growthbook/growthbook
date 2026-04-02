import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";

export function isRampGenerated(
  r: Pick<MinimalFeatureRevisionInterface, "createdBy">,
): boolean {
  return (
    r.createdBy?.type === "system" && r.createdBy.subtype === "ramp-schedule"
  );
}

export interface Props {
  revision: MinimalFeatureRevisionInterface | null | undefined;
  liveVersion: number;
}

export function revisionStatusColor(
  status: MinimalFeatureRevisionInterface["status"] | "live",
): RadixColor {
  switch (status) {
    case "live":
      return "teal";
    case "draft":
      return "plum";

    case "pending-review":
      return "orange";
    case "approved":
      return "grass";
    case "changes-requested":
      return "amber";
    case "discarded":
      return "red";
    case "published":
    default:
      return "gray";
  }
}

export function revisionStatusLabel(
  status: MinimalFeatureRevisionInterface["status"] | "live",
): string {
  switch (status) {
    case "live":
      return "Live";
    case "draft":
      return "Draft";

    case "pending-review":
      return "Pending review";
    case "approved":
      return "Approved";
    case "changes-requested":
      return "Changes requested";
    case "discarded":
      return "Discarded";
    case "published":
      return "Locked";
    default:
      return status;
  }
}

export default function RevisionStatusBadge({ revision, liveVersion }: Props) {
  if (!revision) return null;
  const status = revision.version === liveVersion ? "live" : revision.status;
  return (
    <Badge
      label={revisionStatusLabel(status)}
      radius="full"
      color={revisionStatusColor(status)}
    />
  );
}
