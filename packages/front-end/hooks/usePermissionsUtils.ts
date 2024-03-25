import { useUser } from "@front-end/services/UserContext";

export default function usePermissionsUtil() {
  const { permissionsUtil } = useUser();
  return permissionsUtil;
}
