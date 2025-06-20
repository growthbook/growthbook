import { AGREEMENT_TYPE_AI } from "back-end/src/validators/agreements";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}

export const useAISettings = (
  includeKey: boolean = false
): {
  aiEnabled: boolean;
  aiAgreedTo: boolean;
  openAIDefaultModel: string;
  openAIKey?: string;
} => {
  const { settings, agreements } = useUser();

  const aiEnabled = isCloud()
    ? settings?.aiEnabled !== false && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(settings?.aiEnabled && settings?.openAIAPIKey);
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;
  const openAIDefaultModel = settings?.openAIDefaultModel || "gpt-4o-mini";
  const openAIKey = includeKey ? settings?.openAIAPIKey || "" : "";
  return { aiEnabled, openAIDefaultModel, openAIKey, aiAgreedTo };
};
