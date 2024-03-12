import { useUser } from "@/services/UserContext";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}
