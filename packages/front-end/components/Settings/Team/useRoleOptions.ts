import { RESERVED_ROLE_IDS, getRoleDisplayName } from "shared/permissions";
import { useUser } from "@/services/UserContext";
import useOrgLimits from "@/hooks/useOrgLimits";
import { GroupedValue, SingleValue } from "@/components/Forms/SelectField";

export default function useRoleOptions({
  includeAdminRole = false,
  includeProjectAdminRole = false,
}: {
  includeAdminRole?: boolean;
  includeProjectAdminRole?: boolean;
} = {}): SingleValue[] | GroupedValue[] {
  const { roles, hasCommercialFeature, organization } = useUser();
  const { orgSupportsRoles } = useOrgLimits();

  const hasCustomRolesFeature = hasCommercialFeature("custom-roles");
  const deactivatedRoles = organization.deactivatedRoles || [];

  let roleOptions = [...roles];

  if (!hasCommercialFeature("no-access-role")) {
    roleOptions = roleOptions.filter((r) => r.id !== "noaccess");
  }
  if (!includeAdminRole) {
    roleOptions = roleOptions.filter((r) => r.id !== "admin");
  }
  if (!includeProjectAdminRole || !hasCommercialFeature("project-admin-role")) {
    roleOptions = roleOptions.filter((r) => r.id !== "gbDefault_projectAdmin");
  }
  if (hasCustomRolesFeature && deactivatedRoles.length) {
    roleOptions = roleOptions.filter((r) => !deactivatedRoles.includes(r.id));
  }
  if (includeAdminRole && !orgSupportsRoles()) {
    roleOptions = roleOptions.filter((r) => r.id === "admin");
  }

  const standard: SingleValue[] = [];
  const custom: SingleValue[] = [];

  roleOptions.forEach((r) => {
    const option = {
      label: getRoleDisplayName(r.id, organization),
      value: r.id,
    };
    if (RESERVED_ROLE_IDS.includes(r.id)) {
      standard.push(option);
    } else if (hasCustomRolesFeature) {
      custom.push(option);
    }
  });

  return standard.length && custom.length
    ? [
        { label: "Standard", options: standard },
        { label: "Custom", options: custom },
      ]
    : [...standard, ...custom];
}
