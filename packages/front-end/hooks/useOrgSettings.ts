import { AGREEMENT_TYPE_AI } from "shared/src/validators/agreements";
import { useUser } from "@/services/UserContext";
import { isCloud, hasOpenAIKey } from "@/services/env";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}

export const useAISettings = (): {
  aiEnabled: boolean;
  aiAgreedTo: boolean;
  openAIDefaultModel: string;
} => {
  const { settings, agreements } = useUser();

  const aiEnabled = isCloud()
    ? settings?.aiEnabled !== false && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(settings?.aiEnabled && hasOpenAIKey());
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;

  const openAIDefaultModel = settings?.openAIDefaultModel || "gpt-4o-mini";
  return { aiEnabled, openAIDefaultModel, aiAgreedTo };
};
