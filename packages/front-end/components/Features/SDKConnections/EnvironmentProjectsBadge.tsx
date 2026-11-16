import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";

// A connection with no Projects of its own gets every Project its environment
// allows; the tooltip names them.
export default function EnvironmentProjectsBadge({
  environment,
  projectIds,
}: {
  environment: string;
  projectIds: string[];
}) {
  const { getProjectById } = useDefinitions();
  return (
    <Tooltip
      content={`Every Project in ${environment}: ${projectIds
        .map((id) => getProjectById(id)?.name ?? id)
        .join(", ")}`}
    >
      <Badge
        color="gray"
        variant="soft"
        label={`All env projects (${projectIds.length})`}
      />
    </Tooltip>
  );
}
