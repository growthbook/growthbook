import { useEffect } from "react";
import { useAuth } from "./auth";

export default function useSwitchOrg(newOrg: null | string): void {
  const { orgId, setOrgId, setSpecialOrg } = useAuth();

  useEffect(() => {
    if (orgId && newOrg && orgId !== newOrg) {
      setOrgId(newOrg);
      setSpecialOrg({
        id: newOrg,
        name: "**ADMIN ACCESS**",
        ownerEmail: "",
        url: "",
      });
    }
  }, [orgId, newOrg]);
}
