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
  openAIDefaultModel: string;
  openAIKey?: string;
} => {
  const { settings } = useUser();
  const aiEnabled = isCloud()
    ? settings?.aiEnabled !== false
    : !!(settings?.aiEnabled && settings?.openAIAPIKey);
  const openAIModel = settings?.openAIDefaultModel || "gpt-4o-mini";
  const openAIKey = includeKey ? settings?.openAIAPIKey || "" : "";
  return { aiEnabled, openAIModel, openAIKey };
};
