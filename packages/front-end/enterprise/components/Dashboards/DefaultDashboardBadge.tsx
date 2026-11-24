import {
  DashboardInterface,
  isProjectDefaultDashboard,
} from "shared/enterprise";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import TruncatedText from "@/ui/TruncatedText";
import { useDefinitions } from "@/services/DefinitionsContext";

// Names the Projects that use this dashboard as their default.
export default function DefaultDashboardBadge({
  dashboard,
}: {
  dashboard: DashboardInterface;
}) {
  const { projects } = useDefinitions();
  const defaultFor = projects.filter((p) =>
    isProjectDefaultDashboard(p, dashboard),
  );
  if (defaultFor.length === 0) return null;

  return (
    // One Project is already named in the label.
    <Tooltip
      enabled={defaultFor.length > 1}
      content={`Default dashboard for ${defaultFor.map((p) => p.name).join(", ")}`}
    >
      <Badge
        ml="2"
        radius="full"
        color="violet"
        variant="soft"
        label={
          defaultFor.length === 1 ? (
            // Project names are free text; the full name shows on overflow.
            <TruncatedText
              text={`Default for ${defaultFor[0].name}`}
              maxWidth={200}
            />
          ) : (
            `Default for ${defaultFor.length} Projects`
          )
        }
      />
    </Tooltip>
  );
}
