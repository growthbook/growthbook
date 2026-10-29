import { GrowthBook } from "@growthbook/growthbook-react";
import { GlobalPermission } from "shared/types/organization";
import { Permissions, hasSuperAdminPermission } from "shared/permissions";
import { SuperAdmin } from "shared/validators";
import { SegmentInterface } from "shared/types/segment";
import { AppFeatures } from "shared/types/app-features";
import { isCloud, isMultiOrg } from "@/services/env";
import { PermissionFunctions } from "@/services/UserContext";

export type SidebarLinkFilterProps = {
  permissionsUtils: Permissions;
  segments: SegmentInterface[];
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
  superAdmin: boolean;
  isCloud: boolean;
  isMultiOrg: boolean;
  gb?: GrowthBook<AppFeatures>;
  project?: string;
};

export type SidebarLinkProps = {
  name: string;
  href: string;
  path: RegExp;
  filter?: (props: SidebarLinkFilterProps) => boolean;
  subLinks?: SidebarLinkProps[];
  beta?: boolean;
};

/** Same inputs the sidebar uses for `filter` on nav links — use for Cmd+K / tests so visibility stays in sync. */
export function buildSidebarLinkFilterProps(input: {
  permissionsUtils: Permissions;
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
  superAdmin: SuperAdmin | undefined;
  gb: GrowthBook<AppFeatures> | undefined;
  project: string | undefined;
  segments: SegmentInterface[];
}): SidebarLinkFilterProps {
  return {
    permissionsUtils: input.permissionsUtils,
    permissions: input.permissions,
    // Any super admin permission includes the admin page
    superAdmin: hasSuperAdminPermission(input.superAdmin, "view"),
    isCloud: isCloud(),
    isMultiOrg: isMultiOrg(),
    gb: input.gb,
    project: input.project,
    segments: input.segments,
  };
}
