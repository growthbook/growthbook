import useUser from "./useUser";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}
