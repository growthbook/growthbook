import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const { getProjectById } = useDefinitions();
  const projectNames = projectIds
    .map((id) => getProjectById(id)?.name ?? id)
    .join(", ");
  const projectCount = projectIds.length;
  return (
    <Tooltip content={t`Every Project in ${environment}: ${projectNames}`}>
      <Badge
        color="gray"
        variant="soft"
        label={t`All env projects (${projectCount})`}
      />
    </Tooltip>
  );
}
