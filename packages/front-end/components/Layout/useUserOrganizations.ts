import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";

// The user's organizations, with the current one added for a superAdmin who
// picked it from /admin (it isn't in their list).
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
