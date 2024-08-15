import { useUser } from "@front-end/services/UserContext";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}
