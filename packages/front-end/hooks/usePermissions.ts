import useUser from "./useUser";

export default function usePermissions() {
  const { permissions } = useUser();
  return permissions;
}
