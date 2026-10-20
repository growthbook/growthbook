import { useState } from "react";
import { MemberRoleWithProjects } from "shared/types/organization";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HelperText from "@/ui/HelperText";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import RoleRulesTable from "./RoleRulesTable";

export default function DefaultRoleModal({
  defaultRole,
  close,
}: {
  defaultRole: MemberRoleWithProjects;
  close: () => void;
}) {
  const [value, setValue] = useState(defaultRole);
  const [error, setError] = useState<string | null>(null);
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header="Default role for new members"
      subheader="Applied to new users who join through auto-join or SCIM. Existing members are unaffected."
      open={true}
      size="xl"
      submit={async () => {
        setError(null);
        try {
          await apiCall("/organization/default-role", {
            method: "PUT",
            body: JSON.stringify({ defaultRole: value }),
          });
          refreshOrganization();
        } catch (e) {
          setError(e.message);
          throw e;
        }
      }}
    >
      <RoleRulesTable value={value} setValue={setValue} />
      {error ? <HelperText status="error">{error}</HelperText> : null}
    </ModalStandard>
  );
}
