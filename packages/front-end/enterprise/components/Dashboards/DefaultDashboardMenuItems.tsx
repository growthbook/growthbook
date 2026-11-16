import { DashboardInterface } from "shared/enterprise";
import { ProjectInterface } from "shared/types/project";
import { DropdownMenuItem, DropdownSubMenu } from "@/ui/DropdownMenu";

export default function DefaultDashboardMenuItems({
  dashboard,
  eligibleProjects,
  onSetDefault,
}: {
  dashboard: DashboardInterface;
  eligibleProjects: ProjectInterface[];
  onSetDefault: (projectId: string, dashboardId: string | null) => void;
}) {
  if (eligibleProjects.length === 0) return null;

  const items = eligibleProjects.map((project) => {
    const isCurrentDefault =
      project.settings?.defaultDashboardId === dashboard.id;
    return (
      <DropdownMenuItem
        key={project.id}
        tooltip={
          isCurrentDefault
            ? `Remove this dashboard as the default. Members of the ${project.name} project currently see it on their home page by default.`
            : `Members of the ${project.name} project will see this dashboard on their home page by default. They can still pick a different one for themselves.`
        }
        onClick={() =>
          onSetDefault(project.id, isCurrentDefault ? null : dashboard.id)
        }
      >
        {isCurrentDefault
          ? `Remove as default for ${project.name}`
          : `Set as default for ${project.name}`}
      </DropdownMenuItem>
    );
  });

  if (eligibleProjects.length === 1) {
    return items[0] ?? null;
  }

  const isDefaultForAny = eligibleProjects.some(
    (project) => project.settings?.defaultDashboardId === dashboard.id,
  );

  return (
    <DropdownSubMenu
      trigger={
        isDefaultForAny
          ? "Manage default dashboard"
          : "Set as default dashboard"
      }
    >
      {items}
    </DropdownSubMenu>
  );
}
