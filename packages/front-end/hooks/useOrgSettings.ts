import { AGREEMENT_TYPE_AI } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { isCloud, hasAnyAIKey } from "@/services/env";

export default function useOrgSettings() {
  const { settings, hasCommercialFeature } = useUser();
  if (!hasCommercialFeature("require-approvals") && settings) {
    return { ...settings, requireReviews: [] };
  }
  return settings;
}

export const useAISettings = (): {
  aiEnabled: boolean;
  aiAgreedTo: boolean;
  defaultAIModel: string;
} => {
  const { settings, agreements } = useUser();

  const aiEnabled = isCloud()
    ? !!settings?.aiEnabled && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(settings?.aiEnabled && hasAnyAIKey());
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;

  const defaultAIModel = settings?.defaultAIModel || "gpt-4o-mini";
  return { aiEnabled, defaultAIModel, aiAgreedTo };
};
