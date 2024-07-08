import { useUser } from "@/services/UserContext";

export default function usePermissionsUtil() {
  const { permissionsUtil } = useUser();
  return permissionsUtil;
}
