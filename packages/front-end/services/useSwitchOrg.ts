import { useEffect } from "react";
import { useAuth } from "./auth";

export default function useSwitchOrg(newOrg: null | string): void {
  const { orgId, setOrgId, setSpecialOrg } = useAuth();

  useEffect(() => {
    if (orgId && newOrg && orgId !== newOrg) {
      // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
      setOrgId(newOrg);
      // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
      setSpecialOrg({
        id: newOrg,
        name: "**ADMIN ACCESS**",
        ownerEmail: "",
        url: "",
      });
    }
  }, [orgId, newOrg]);
}
