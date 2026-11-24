import {
  DashboardInterface,
  isDashboardEligibleAsProjectDefault,
  isProjectDefaultDashboard,
} from "shared/enterprise";
import { DropdownMenuItem, DropdownSubMenu } from "@/ui/DropdownMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSetProjectDefaultDashboard } from "@/hooks/useSetProjectDefaultDashboard";

export default function DefaultDashboardMenuItems({
  dashboard,
}: {
  dashboard: DashboardInterface;
}) {
  const { project, projects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const setProjectDefaultDashboard = useSetProjectDefaultDashboard();

  // Setting a Project's default needs permission on that Project, not on the
  // dashboard. With a Project selected, only that one is offered, which keeps
  // the menu short.
  const eligibleProjects = projects.filter(
    (p) =>
      (!project || p.id === project) &&
      isDashboardEligibleAsProjectDefault(dashboard, p.id) &&
      permissionsUtil.canUpdateProject(p.id),
  );
  if (eligibleProjects.length === 0) return null;

  const items = eligibleProjects.map((p) => {
    const isCurrentDefault = isProjectDefaultDashboard(p, dashboard);
    return (
      <DropdownMenuItem
        key={p.id}
        keepOpenWhileLoading
        onClick={() =>
          setProjectDefaultDashboard(
            p.id,
            isCurrentDefault ? null : dashboard.id,
          )
        }
      >
        {isCurrentDefault
          ? `Remove as default for ${p.name}`
          : `Set as default for ${p.name}`}
      </DropdownMenuItem>
    );
  });

  if (items.length === 1) return items[0];

  return (
    <DropdownSubMenu
      trigger={
        eligibleProjects.some((p) => isProjectDefaultDashboard(p, dashboard))
          ? "Manage default dashboard"
          : "Set as default dashboard"
      }
    >
      {items}
    </DropdownSubMenu>
  );
}
