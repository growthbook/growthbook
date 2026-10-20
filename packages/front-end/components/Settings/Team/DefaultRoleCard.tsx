import { useState } from "react";
import { getDefaultRole } from "shared/permissions";
import { useUser } from "@/services/UserContext";
import DefaultRoleModal from "./DefaultRoleModal";
import RoleRulesSummaryRow from "./RoleRulesSummary";

export default function DefaultRoleCard() {
  const [open, setOpen] = useState(false);
  const { organization, permissionsUtil } = useUser();

  const defaultRole = getDefaultRole(organization);

  return (
    <>
      {open && (
        <DefaultRoleModal
          defaultRole={defaultRole}
          close={() => setOpen(false)}
        />
      )}
      <RoleRulesSummaryRow
        label="Default role for new members"
        value={defaultRole}
        onEdit={() => setOpen(true)}
        disabled={!permissionsUtil.canManageTeam()}
      />
    </>
  );
}
