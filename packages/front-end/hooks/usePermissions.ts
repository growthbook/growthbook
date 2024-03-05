import { useUser } from "@/services/UserContext";

export default function usePermissions() {
  const { permissions } = useUser();
  return permissions;
}
