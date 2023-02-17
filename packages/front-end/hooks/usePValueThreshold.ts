import useOrgSettings from "./useOrgSettings";

export default function usePValueThreshold() {
  const settings = useOrgSettings();
  return settings.pValueThreshold || 0.05;
}
