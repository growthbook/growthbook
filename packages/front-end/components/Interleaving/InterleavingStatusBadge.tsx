import type { ApiInterleavingInterface } from "shared/validators";
import Badge from "@/ui/Badge";

export default function InterleavingStatusBadge({
  interleaving,
}: {
  interleaving: Pick<ApiInterleavingInterface, "status" | "archived">;
}) {
  if (interleaving.archived) {
    return <Badge label="Archived" color="gray" variant="soft" />;
  }
  switch (interleaving.status) {
    case "draft":
      return <Badge label="Draft" color="indigo" variant="soft" />;
    case "running":
      return <Badge label="Running" color="teal" variant="solid" />;
    case "stopped":
      return <Badge label="Stopped" color="gray" variant="soft" />;
    default: {
      const unknown: never = interleaving.status;
      throw new Error(`Unknown interleaving status: ${unknown}`);
    }
  }
}
