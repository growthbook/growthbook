import { AGREEMENT_TYPE_AI } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { isCloud, hasOpenAIKey, hasOllamaServer } from "@/services/env";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}

export const useAISettings = (): {
  aiEnabled: boolean;
  aiAgreedTo: boolean;
  defaultModel: string;
} => {
  const { settings, agreements } = useUser();

  const aiEnabled = isCloud()
    ? settings?.aiEnabled !== false && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(
        settings?.aiEnabled &&
        ((settings?.aiProvider === "openai" && hasOpenAIKey()) ||
          (settings?.aiProvider === "ollama" &&
            !!settings?.ollamaDefaultModel &&
            hasOllamaServer()))
      );
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;

  const openAIDefaultModel = settings?.openAIDefaultModel || "gpt-4o-mini";
  const ollamaDefaultModel = settings?.ollamaDefaultModel || "";
  const defaultModel =
    settings?.aiProvider === "openai" ? openAIDefaultModel : ollamaDefaultModel;
  return { aiEnabled, defaultModel, aiAgreedTo };
};
