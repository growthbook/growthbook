import { useUser } from "@front-end/services/UserContext";

export default function usePermissions() {
  const { permissions } = useUser();
  return permissions;
}
