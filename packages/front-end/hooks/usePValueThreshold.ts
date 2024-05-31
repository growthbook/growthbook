import { DEFAULT_P_VALUE_THRESHOLD } from "shared/constants";
import useOrgSettings from "./useOrgSettings";

export default function usePValueThreshold() {
  const settings = useOrgSettings();
  return settings.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD;
}
