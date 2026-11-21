import {
  DashboardInterface,
  isDashboardEligibleAsProjectDefault,
} from "shared/enterprise";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";

// Names the Projects that show this dashboard on Home. A stored default that
// is no longer eligible is ignored on Home, so it isn't shown here either.
export default function DefaultDashboardBadge({
  dashboard,
}: {
  dashboard: DashboardInterface;
}) {
  const { projects } = useDefinitions();
  const defaultFor = projects.filter(
    (p) =>
      p.defaultDashboardId === dashboard.id &&
      isDashboardEligibleAsProjectDefault(dashboard, p.id),
  );
  if (defaultFor.length === 0) return null;

  return (
    // One Project is already named in the label.
    <Tooltip
      enabled={defaultFor.length > 1}
      content={`Home page default for ${defaultFor.map((p) => p.name).join(", ")}`}
    >
      <Badge
        ml="2"
        radius="full"
        color="violet"
        variant="soft"
        label={
          defaultFor.length === 1
            ? `Default for ${defaultFor[0].name}`
            : `Default for ${defaultFor.length} Projects`
        }
      />
    </Tooltip>
  );
}
