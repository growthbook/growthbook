import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";

/**
 * Includes the current org for a superAdmin who picked it from /admin, since it
 * isn't in their list.
 */
export function useUserOrganizations(): { id: string; name: string }[] {
  const { organization } = useUser();
  const { organizations } = useAuth();
  const list = organizations ? [...organizations] : [];
  if (
    organization.id &&
    organization.name &&
    !list.some((o) => o.id === organization.id)
  ) {
    list.push({ id: organization.id, name: organization.name });
  }
  return list;
}

/**
 * The current organization and switching to another, remembered for the next
 * visit. The one switcher behind the side nav's organization menu and the
 * profile menu's picker.
 */
export function useSwitchOrganization(): {
  currentOrgId: string;
  switchOrg: (id: string) => void;
} {
  const { organization } = useUser();
  const { orgId, setOrgId } = useAuth();
  const currentOrgId = orgId ?? organization.id ?? "";
  const switchOrg = (id: string) => {
    if (id === currentOrgId || !setOrgId) return;
    setOrgId(id);
    try {
      localStorage.setItem("gb-last-picked-org", `"${id}"`);
    } catch (e) {
      console.warn("Unable to save last org in localStorage");
    }
  };
  return { currentOrgId, switchOrg };
}
